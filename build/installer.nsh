!macro customHeader
  !include "LogicLib.nsh"
!macroend

!macro customInstall
  ; Ensure MK-AI-Data root exists in user's LocalAppData without requiring elevated privileges
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\datasets"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\projects"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\models"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\model_weights"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\training_runs"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\exports"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\logs"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\cache"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\temp"
  CreateDirectory "$LOCALAPPDATA\MK-AI-Data\backups"
!macroend

!macro customUnInstall
  ; Clean transient engine lockfile on any uninstall
  Delete "$LOCALAPPDATA\MK-AI-Data\temp\mk-engine.lock.json"

  ; On interactive user uninstall (not silent update), wipe encrypted local engine credentials cleanly
  ${Unless} ${Silent}
    Delete "$APPDATA\MK AI Desktop\security\mk-engine-credential.dat"
    Delete "$APPDATA\MK AI Desktop\security\mk-engine-master.key"
    RMDir /r "$APPDATA\MK AI Desktop\security"
  ${EndUnless}

  ; Preserve user datasets, projects, and trained weights on uninstall unless explicitly confirmed
  ${If} ${FileExists} "$LOCALAPPDATA\MK-AI-Data\*.*"
    MessageBox MB_YESNO|MB_ICONQUESTION "Preserve your MK AI datasets, projects, and trained weights in $LOCALAPPDATA\MK-AI-Data?$\r$\nSelect YES to keep your data (Recommended), or NO to delete all MK AI local data." IDYES skipDataRemove
      RMDir /r "$LOCALAPPDATA\MK-AI-Data"
    skipDataRemove:
  ${EndIf}
!macroend
