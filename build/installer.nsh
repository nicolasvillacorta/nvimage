; Accesos directos con el ícono de NVTabs (el .exe no se modifica para que
; Smart App Control de Windows 11 lo siga reconociendo).
!macro customInstall
  CreateShortCut "$DESKTOP\NVTabs.lnk" "$INSTDIR\NVTabs.exe" "" "$INSTDIR\resources\icon.ico" 0
  WinShell::SetLnkAUMI "$DESKTOP\NVTabs.lnk" "com.nvtabs.app"
  CreateShortCut "$SMPROGRAMS\NVTabs.lnk" "$INSTDIR\NVTabs.exe" "" "$INSTDIR\resources\icon.ico" 0
  WinShell::SetLnkAUMI "$SMPROGRAMS\NVTabs.lnk" "com.nvtabs.app"
!macroend
