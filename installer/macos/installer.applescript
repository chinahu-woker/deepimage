on run
  try
    set selectedVersion to button returned of (display dialog "选择要安装的 deepImage 版本：" & return & return & "开源版：自行配置图片和视频服务商。" & return & "公司版：登录 AIKNA 后自动配置兼容模型。" buttons {"取消", "开源版", "公司版"} default button "公司版" cancel button "取消" with title "安装 deepImage")
    if selectedVersion is "开源版" then
      set edition to "open-source"
    else
      set edition to "newapi"
    end if
    set appPath to "/Applications/DeepSeek Harness.app"
    try
      do shell script "test -x " & quoted form of (appPath & "/Contents/Resources/runtime/cli/bin/dsh")
    on error
      set homeApp to (POSIX path of (path to home folder)) & "Applications/DeepSeek Harness.app"
      try
        do shell script "test -x " & quoted form of (homeApp & "/Contents/Resources/runtime/cli/bin/dsh")
        set appPath to homeApp
      on error
        display dialog "未在常用位置找到 DeepSeek Harness。请选择已安装的 DeepSeek Harness.app。" buttons {"取消", "选择应用"} default button "选择应用" cancel button "取消" with title "安装 deepImage"
        set appPath to POSIX path of (choose file with prompt "选择 DeepSeek Harness.app" of type {"com.apple.application-bundle"})
      end try
    end try
    repeat
      try
        do shell script "/usr/bin/pgrep -f '/Contents/MacOS/[D]eepSeek Harness' >/dev/null"
        display dialog "请先在 DeepSeek Harness 中按 ⌘Q 完全退出应用，然后点击“继续”。" buttons {"取消", "继续"} default button "继续" cancel button "取消" with title "安装 deepImage"
      on error errorMessage number errorNumber
        if errorNumber is -128 then error number -128
        exit repeat
      end try
    end repeat
    set resourcesPath to (POSIX path of (path to me)) & "/Contents/Resources/"
    set installScript to resourcesPath & "install.sh"
    display dialog "准备联网下载并安装" & selectedVersion & "的最新版本，请耐心等待。" buttons {"取消", "开始安装"} default button "开始安装" cancel button "取消" with title "安装 deepImage"
    set progress description to "正在安装 deepImage…"
    set progress additional description to "请不要关闭安装器。"
    set progress total steps to 0
    try
      do shell script quoted form of installScript & " " & quoted form of appPath & " " & quoted form of edition & " 2>&1"
    on error errorMessage number errorNumber
      set progress total steps to 0
      display dialog "安装未完成。请确认已打开过桌面版并完全退出，然后检查网络及应用版本。" & return & return & errorMessage buttons {"好"} default button "好" with title "安装 deepImage" with icon stop
      return
    end try
    set progress total steps to 0
    set response to button returned of (display dialog selectedVersion & "安装完成！打开 DeepSeek Harness 后，在“设置 → deepImage”中配置即可使用。" buttons {"完成", "打开 DeepSeek Harness"} default button "打开 DeepSeek Harness" with title "安装 deepImage")
    if response is "打开 DeepSeek Harness" then do shell script "/usr/bin/open " & quoted form of appPath
  on error errorMessage number errorNumber
    if errorNumber is not -128 then display dialog "安装器遇到问题：" & return & errorMessage buttons {"好"} default button "好" with title "安装 deepImage" with icon stop
  end try
end run
