use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

pub const AUTH_CALLBACK_PORT: u16 = 18765;
pub const AUTH_CALLBACK_PATH: &str = "/auth/callback";

pub struct AuthCallbackState {
    pub redirect_url: Mutex<Option<String>>,
}

impl Default for AuthCallbackState {
    fn default() -> Self {
        Self {
            redirect_url: Mutex::new(None),
        }
    }
}

pub fn callback_url() -> String {
    format!("http://127.0.0.1:{AUTH_CALLBACK_PORT}{AUTH_CALLBACK_PATH}")
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        match TcpListener::bind(("127.0.0.1", AUTH_CALLBACK_PORT)).await {
            Ok(listener) => {
                if let Some(state) = app.try_state::<AuthCallbackState>() {
                    *state.redirect_url.lock().await = Some(callback_url());
                }
                loop {
                    let accepted = listener.accept().await;
                    let Ok((mut socket, _)) = accepted else { continue };
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let mut buf = vec![0u8; 16_384];
                        let n = match socket.read(&mut buf).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => n,
                        };
                        let request = String::from_utf8_lossy(&buf[..n]);
                        let Some(path) = parse_callback_request(&request) else {
                            let _ = socket.write_all(http_response(404, "Not found").as_bytes()).await;
                            return;
                        };
                        let url = format!("http://127.0.0.1:{AUTH_CALLBACK_PORT}{path}");
                        let _ = app.emit("auth://callback", url);
                        let _ = socket.write_all(http_response(200, SUCCESS_PAGE).as_bytes()).await;
                    });
                }
            }
            Err(error) => {
                eprintln!("[scribble] auth callback server unavailable: {error}");
            }
        }
    });
}

pub fn parse_callback_request(request: &str) -> Option<String> {
    let normalized = request.replace('\n', "\r\n").replace("\r\r\n", "\r\n");
    let mut lines = normalized.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?;
    let path = parts.next()?;
    if !method.eq_ignore_ascii_case("GET") || !path.starts_with(AUTH_CALLBACK_PATH) {
        return None;
    }

    let mut host_ok = false;
    for line in lines {
        if line.is_empty() {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("host") {
            let host = value.trim();
            host_ok = host.starts_with("127.0.0.1") || host.starts_with("localhost");
        }
    }
    host_ok.then(|| path.to_string())
}

fn http_response(status: u16, body: &str) -> String {
    let reason = match status {
        200 => "OK",
        _ => "Not Found",
    };
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    )
}

const SUCCESS_PAGE: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signed in to Scribble</title>
  <style>
    :root { color-scheme: dark; }
    html, body { height: 100%; margin: 0; }
    body {
      min-height: 100%;
      display: grid;
      place-items: center;
      font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
      background:
        radial-gradient(900px 420px at 20% -10%, rgba(79, 124, 255, 0.2), transparent 55%),
        #0B1220;
      color: #E8EEF9;
    }
    main {
      width: min(28rem, calc(100vw - 2rem));
      padding: 1.85rem;
      border: 1px solid rgba(232, 238, 249, 0.1);
      border-radius: 1.5rem;
      background: rgba(16, 22, 38, 0.88);
      box-shadow: 0 28px 90px -28px rgba(0, 0, 0, 0.75);
    }
    p.eyebrow { margin: 0 0 0.55rem; font-size: 11px; font-weight: 650; letter-spacing: 0.16em; text-transform: uppercase; color: #8EB0FF; }
    h1 { margin: 0 0 0.75rem; font-family: Georgia, serif; font-size: 1.7rem; letter-spacing: -0.03em; }
    p { margin: 0; line-height: 1.55; color: #9AA6BF; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Scribble</p>
    <h1>You're signed in</h1>
    <p>You can close this site now and go back to Scribble.</p>
  </main>
</body>
</html>
"##;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_local_callback_requests() {
        let request = "GET /auth/callback?code=abc&sb_flow_id=flow HTTP/1.1\r\nHost: 127.0.0.1:18765\r\n\r\n";
        assert_eq!(
            parse_callback_request(request).as_deref(),
            Some("/auth/callback?code=abc&sb_flow_id=flow")
        );
    }

    #[test]
    fn rejects_non_local_hosts() {
        let request = "GET /auth/callback?code=abc HTTP/1.1\r\nHost: example.com\r\n\r\n";
        assert!(parse_callback_request(request).is_none());
    }
}
