; Uninstall hook: take the two loopback bearer tokens with us.
;
; Tauri's own uninstaller deletes `$APPDATA\<bundle id>` and
; `$LOCALAPPDATA\<bundle id>` when "Delete the application data" is ticked, and
; nothing else. This app does not keep its runtime files there. `app_data_dir()`
; in src-tauri/src/setup.rs deliberately returns `%LOCALAPPDATA%\DR Companion
; Data`, outside both the install directory and the bundle-id directory, so that
; an uninstall can never take a Lich tree or a user's own scripts with it.
;
; The cost of that, measured on a clean VM on 5 Sep 2026 (F8,
; docs/verification/uninstall-2026-09-05.md): `presentation-bridge.token` and
; `script-api.token` - 64-character bearer tokens for two loopback sockets -
; survived BOTH uninstall paths. Ticking the box did not remove them, because
; the box only reaches the bundle-id folder. There was no route through the
; product that removed a live credential, which is the opposite of what an
; uninstall is for.
;
; So the tokens and their port files go unconditionally: they are not user data,
; the app rewrites all four on every start (presentation_bridge.rs:463,
; script_api.rs:325), and after an uninstall nothing owns them. Leaving a
; credential behind is not a preference, so it is not on the checkbox.
;
; The 65 MB cached copy of Ruby4Lich5's own installer IS on the checkbox: it is
; app-managed cache rather than a credential, and somebody who declined to
; delete their data may reasonably want the download they already paid for.
;
; What this must never do is `RMDir /r` the data directory itself. It can hold
; `portraits\` (the player's own images, custom_portraits.rs:21) and whole
; `lich\` and `genie\` installs (setup.rs:406, 796). The bare `RMDir` at the end
; removes the folder only when it is already empty, which is exactly the case
; where nothing of the user's is in it.
;
; `$UpdateMode` guards the same way the generated installer.nsi does around its
; own app-data deletion: an update runs the uninstaller too, and an update is
; not an uninstall.
;
; Wired in by `bundle.windows.nsis.installerHooks` in tauri.conf.json.
; `tools/bundle-test.mjs` checks the four names and the folder name here still
; match the Rust that writes them, so this file cannot quietly go on deleting
; paths the app has moved away from.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current

    Delete "$LOCALAPPDATA\DR Companion Data\presentation-bridge.token"
    Delete "$LOCALAPPDATA\DR Companion Data\presentation-bridge.port"
    Delete "$LOCALAPPDATA\DR Companion Data\script-api.token"
    Delete "$LOCALAPPDATA\DR Companion Data\script-api.port"

    ${If} $DeleteAppDataCheckboxState = 1
      RMDir /r "$LOCALAPPDATA\DR Companion Data\downloads"
    ${EndIf}

    ; Not /r. Succeeds only if the folder is now empty.
    RMDir "$LOCALAPPDATA\DR Companion Data"
  ${EndIf}
!macroend
