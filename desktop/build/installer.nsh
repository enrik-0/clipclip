; electron-builder hides the install log (`ShowInstDetails nevershow`). Show the
; "Mostrar detalles" button, collapsed by default, so the user can watch what the
; installer is doing while the large runtime is extracted.
!macro customHeader
  ShowInstDetails hide
!macroend

; The bundled runtime contains paths longer than MAX_PATH (260), which NSIS
; RMDir cannot delete. cmd handles them with the \\?\ prefix.
!macro customRemoveFiles
  SetOutPath $TEMP
  nsExec::Exec 'cmd.exe /c rd /s /q "\\?\$INSTDIR"'
  Pop $R0
!macroend
