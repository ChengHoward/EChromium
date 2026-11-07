param(
  [Parameter(Mandatory=$true)][long]$PanelHandle,
  [Parameter(Mandatory=$true)][long]$OwnerHandle,
  [Parameter(Mandatory=$true)][uint32]$FixtureProcessId,
  [string]$TextBase64,
  [int]$Key=0
)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FixturePanelInput {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
  [DllImport("user32.dll", EntryPoint="PostMessageW", CharSet=CharSet.Unicode)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@
[FixturePanelInput]::SetProcessDPIAware() | Out-Null
$panelTarget=[IntPtr]::new($PanelHandle)
$expectedOwner=[IntPtr]::new($OwnerHandle)
foreach($target in @($panelTarget,$expectedOwner)){
  [uint32]$actualProcess=0
  if([FixturePanelInput]::GetWindowThreadProcessId($target,[ref]$actualProcess) -eq 0 -or $actualProcess -ne $FixtureProcessId){throw 'Target is outside the isolated fixture process.'}
}
if([FixturePanelInput]::GetWindow($panelTarget,4) -ne $expectedOwner){throw 'Target is not owned by this fixture window.'}
$className=New-Object System.Text.StringBuilder 256
[FixturePanelInput]::GetClassName($panelTarget,$className,256) | Out-Null
if(-not $className.ToString().StartsWith('Chrome_WidgetWin_')){throw 'Target is not a Views popup.'}
# Send characters only to the validated native widget; never inject global keyboard input.
if($TextBase64){
  $fixtureText=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextBase64))
  foreach($character in $fixtureText.ToCharArray()){
    if(-not [FixturePanelInput]::PostMessage($panelTarget,0x0102,[IntPtr]::new([int]$character),[IntPtr]::new(1))){throw 'Cannot type into fixture panel.'}
  }
}
if($Key -gt 0){
  [FixturePanelInput]::PostMessage($panelTarget,0x0100,[IntPtr]::new($Key),[IntPtr]::new(1)) | Out-Null
  [FixturePanelInput]::PostMessage($panelTarget,0x0101,[IntPtr]::new($Key),[IntPtr]::new(0xC0000001L)) | Out-Null
}
