; electron-builder hides the install log (`ShowInstDetails nevershow`). Show the
; "Mostrar detalles" button, collapsed by default, so the user can watch what the
; installer is doing while the large runtime is extracted.
!macro customHeader
  ShowInstDetails hide
!macroend
