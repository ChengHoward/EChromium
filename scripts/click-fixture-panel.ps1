param(
  [Parameter(Mandatory=$true)][long]$PanelHandle,
  [Parameter(Mandatory=$true)][long]$OwnerHandle,
  [Parameter(Mandatory=$true)][uint32]$FixtureProcessId,
  [Parameter(Mandatory=$true)][double]$FractionX,
  [Parameter(Mandatory=$true)][double]$FractionY
)
$ErrorActionPreference='Stop'
if($FractionX -le 0 -or $FractionX -ge 1 -or $FractionY -le 0 -or $FractionY -ge 1){throw 'Invalid fixture coordinates.'}
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
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
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
$client=New-Object FixturePanelInput+Rect
if(-not [FixturePanelInput]::GetClientRect($panelTarget,[ref]$client)){throw 'Cannot read fixture client bounds.'}
$localX=[int](($client.Right-$client.Left)*$FractionX)
$localY=[int](($client.Bottom-$client.Top)*$FractionY)
$point=[IntPtr]::new(($localY -shl 16) -bor ($localX -band 65535))
# Targeted window messages only. Do not move the cursor or inject global input.
if(-not [FixturePanelInput]::PostMessage($panelTarget,0x0200,[IntPtr]::Zero,$point)){throw 'Cannot post fixture pointer move.'}
if(-not [FixturePanelInput]::PostMessage($panelTarget,0x0201,[IntPtr]::new(1),$point)){throw 'Cannot post fixture press.'}
if(-not [FixturePanelInput]::PostMessage($panelTarget,0x0202,[IntPtr]::Zero,$point)){throw 'Cannot post fixture release.'}
