Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$title = '安装 deepImage'
function Show-Message([string]$message, [System.Windows.Forms.MessageBoxIcon]$icon = 'Information') {
    [void][System.Windows.Forms.MessageBox]::Show($message, $title, 'OK', $icon)
}
try {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $title
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(470, 230)
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $label = New-Object System.Windows.Forms.Label
    $label.Text = "选择要安装的 deepImage 版本：`r`n`r`n开源版：自行配置图片和视频服务商。`r`n公司版：登录 AIKNA 后自动配置兼容模型。"
    $label.AutoSize = $true
    $label.Location = New-Object System.Drawing.Point(20, 20)
    $form.Controls.Add($label)
    $openButton = New-Object System.Windows.Forms.Button
    $openButton.Text = '开源版'
    $openButton.Location = New-Object System.Drawing.Point(160, 140)
    $openButton.Add_Click({ $form.Tag = 'open'; $form.Close() })
    $form.Controls.Add($openButton)
    $companyButton = New-Object System.Windows.Forms.Button
    $companyButton.Text = '公司版'
    $companyButton.Location = New-Object System.Drawing.Point(260, 140)
    $companyButton.Add_Click({ $form.Tag = 'company'; $form.Close() })
    $form.Controls.Add($companyButton)
    [void]$form.ShowDialog()
    if (-not $form.Tag) { return }
    $edition = $form.Tag
    $packageName = if ($edition -eq 'open') { 'deepimage-open-source.tgz' } else { 'deepimage-newapi.tgz' }
    $package = Join-Path $PSScriptRoot $packageName
    if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { throw '安装包不完整，请重新下载安装器。' }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
        (Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe')
    )
    $app = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $app) {
        Show-Message '未在常用位置找到 DeepSeek Harness，请选择已安装的 DeepSeek Harness.exe。'
        $picker = New-Object System.Windows.Forms.OpenFileDialog
        $picker.Title = '选择 DeepSeek Harness.exe'
        $picker.Filter = 'DeepSeek Harness|DeepSeek Harness.exe|应用程序|*.exe'
        if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
        $app = $picker.FileName
    }
    $cli = Join-Path (Split-Path -Parent $app) 'resources\runtime\cli\bin\dsh.cmd'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw '无法找到桌面应用内置的 dsh 命令，请检查所选应用。' }
    while (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
        $answer = [System.Windows.Forms.MessageBox]::Show('请从任务栏托盘完全退出 DeepSeek Harness，然后点击“确定”。', $title, 'OKCancel', 'Information')
        if ($answer -ne [System.Windows.Forms.DialogResult]::OK) { return }
    }
    $answer = [System.Windows.Forms.MessageBox]::Show('准备安装 deepImage。安装可能需要联网下载依赖，请耐心等待。', $title, 'OKCancel', 'Information')
    if ($answer -ne [System.Windows.Forms.DialogResult]::OK) { return }
    $store = Join-Path $env:LOCALAPPDATA 'deepImage\installer-packages'
    [void](New-Item -ItemType Directory -Force -Path $store)
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $package).Hash.ToLowerInvariant()
    $permanent = Join-Path $store "$hash.tgz"
    if (-not (Test-Path -LiteralPath $permanent)) { Copy-Item -LiteralPath $package -Destination $permanent }
    $working = New-Object System.Windows.Forms.Form
    $working.Text = $title
    $working.StartPosition = 'CenterScreen'
    $working.Size = New-Object System.Drawing.Size(420, 130)
    $working.ControlBox = $false
    $workingLabel = New-Object System.Windows.Forms.Label
    $workingLabel.Text = '正在安装 deepImage，请不要关闭安装器…'
    $workingLabel.AutoSize = $true
    $workingLabel.Location = New-Object System.Drawing.Point(20, 30)
    $working.Controls.Add($workingLabel)
    $working.Show()
    [System.Windows.Forms.Application]::DoEvents()
    $output = (& $cli plugin --profile desktop add $permanent 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    $working.Close()
    if ($exitCode -ne 0) { throw "安装未完成。请确认已打开过桌面版并完全退出，然后检查网络及应用版本。`r`n`r`n$output" }
    $answer = [System.Windows.Forms.MessageBox]::Show('安装完成！打开 DeepSeek Harness 后，在“设置 → deepImage”中配置即可使用。现在打开桌面应用吗？', $title, 'YesNo', 'Information')
    if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { Start-Process -FilePath $app }
} catch {
    if ($working) { $working.Close() }
    Show-Message ("安装器遇到问题：`r`n" + $_.Exception.Message) 'Error'
}
