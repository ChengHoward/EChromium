param([Parameter(Mandatory=$true)][long]$WindowHandle,[Parameter(Mandatory=$true)][string]$OutputPath,[ValidateRange(0,400)][int]$Padding=0)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class BrowserCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect rect, int size);
}
'@
[BrowserCapture]::SetProcessDPIAware() | Out-Null
$handle=[IntPtr]::new($WindowHandle)
$foreground=[BrowserCapture]::GetForegroundWindow()
if($foreground -ne $handle){
  [uint32]$browserProcess=0
  [BrowserCapture]::GetWindowThreadProcessId($handle,[ref]$browserProcess) | Out-Null
  $candidateOwner=$foreground
  $ownedForeground=$false
  for($depth=0;$depth -lt 8 -and $candidateOwner -ne [IntPtr]::Zero;$depth++){
    [uint32]$candidateProcess=0
    [BrowserCapture]::GetWindowThreadProcessId($candidateOwner,[ref]$candidateProcess) | Out-Null
    if($candidateProcess -ne $browserProcess){break}
    if($candidateOwner -eq $handle){$ownedForeground=$true;break}
    $candidateOwner=[BrowserCapture]::GetWindow($candidateOwner,4)
  }
  if(-not $ownedForeground){throw 'Browser or its owned popup is not foreground; do not capture another application.'}
}
$rect=New-Object BrowserCapture+Rect
if(-not [BrowserCapture]::GetWindowRect($handle,[ref]$rect)){throw 'Cannot read browser bounds.'}
$visible=New-Object BrowserCapture+Rect
if([BrowserCapture]::DwmGetWindowAttribute($handle,9,[ref]$visible,[System.Runtime.InteropServices.Marshal]::SizeOf($visible)) -eq 0){$rect=$visible}
if($Padding -gt 0){
  $screen=[System.Windows.Forms.Screen]::FromHandle($handle).Bounds
  $rect.Left=[Math]::Max($screen.Left,$rect.Left-$Padding)
  $rect.Top=[Math]::Max($screen.Top,$rect.Top-$Padding)
  $rect.Right=[Math]::Min($screen.Right,$rect.Right+$Padding)
  $rect.Bottom=[Math]::Min($screen.Bottom,$rect.Bottom+$Padding)
}
$bitmap=New-Object System.Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
try{$graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size);$bitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png)}
finally{$graphics.Dispose();$bitmap.Dispose()}
