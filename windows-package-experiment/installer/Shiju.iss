#define MyAppName "Shiju"
#define MyAppVersion "1.9.0"
#define MyAppPublisher "Shiju"
#define MyAppExeName "Shiju.exe"

[Setup]
AppId={{7D6B31C8-D5DD-482E-A14C-2DC333B340AB}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\Shiju
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\output
OutputBaseFilename=Shiju-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\Shiju.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "..\dist\Shiju\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\manual\Shiju-User-Guide.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\manual\Shiju-User-Guide.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autoprograms}\Shiju User Guide"; Filename: "{app}\Shiju-User-Guide.txt"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\Shiju-User-Guide.txt"; Description: "Open the Shiju user guide"; Flags: postinstall shellexec skipifsilent
