; Scribble — friendlier school / lab installs (no admin required).

!macro NSIS_HOOK_POSTINSTALL
  ; Quiet installs are in-app updates. Scribble restarts itself after those.
  IfSilent hook_done
  MessageBox MB_YESNO|MB_ICONQUESTION "Scribble is installed.$\r$\n$\r$\nOpen Scribble now?" IDNO hook_done
  Exec '"$INSTDIR\scribble-desktop.exe"'
  hook_done:
!macroend
