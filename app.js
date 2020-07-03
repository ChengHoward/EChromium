'use strict';

const { ipcMain, app, BrowserWindow, Menu, MenuItem, Tray, dialog, nativeImage, globalShortcut } = require('electron');
const path = require('path')
const url = require('url')
var fs = require("fs")
const AppName = "HowardBrowser"
const AppName_en = "HowardBrowser"
const reg_content = 'HKLM\\SOFTWARE\\Classes\\' + AppName_en
// let appTray;
// let App_Browser_Win_list = [];
let App_Browser_Win_list = new Set();
app.allowRendererProcessReuse = true;
/*隐藏electron创听的菜单栏*/
// Menu.setApplicationMenu(null);
var JSONStorage = require('node-localstorage').JSONStorage;
var storageLocation = app.getPath('userData');
var nodeStorage = new JSONStorage(storageLocation);

const regedit = require('regedit');
let exe_url = app.getPath('exe');

// 加载主题模式
var browser_theme;
try { browser_theme = nodeStorage.getItem('browser_theme') || "light"; } catch (err) { }

//默认下载保存路径
var download_save_path = app.getPath("downloads") + "\\" + AppName + "下载\\";
var is_download_user_tip = false;
var downloadData = nodeStorage.getItem('downloadData') || {};
var uuid = require('node-uuid');

//窗口状态
var winState = undefined;



const gotTheLock = app.requestSingleInstanceLock();
const args = [];
if (!app.isPackaged) {
    args.push(path.resolve(process.argv[1]));
}
const PROTOCOL = 'howardbrowser';
app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, args);
const PDFWindow = require('electron-pdf-window')

function opSet(argv) {
    argv = argv.filter(val => val !== "--allow-file-access-from-files");
    argv = argv.filter(val => val.indexOf("--original-process-start-time=") === -1);

    var file_path = ""

    argv.forEach((str, i, obj) => {
        var last_len = str.lastIndexOf(".");
        var len = str.length;
        var pathf = str.substring(last_len, len).toLowerCase();
        if (pathf !== ".exe") {
            var stat = fs.statSync(str);
            if (stat.isFile()) {
                file_path = str;
            }
        }
    })
    return file_path;
}
function handleArgv(argv) {
    const prefix = `${PROTOCOL}:`;
    const offset = app.isPackaged ? 1 : 2;
    const url = argv.find((arg, i) => i >= offset && arg.startsWith(prefix));
    return url ? handleUrl(url) : opSet(argv);
}

function handleUrl(urlStr) {
    // myapp:?a=1&b=2
    const urlObj = new URL(urlStr);
    const { searchParams } = urlObj;
    return searchParams
}

function notice(title = "通知", content = "通知内容", icon = "fad fa-flag-checkered") {
    App_Browser_Win_list.forEach((win) => {
        win.webContents.send('notice-msg', title, content, icon);
    });

}


for (let key in downloadData) {
    var item = downloadData[key]
    if (item.download_state == "play") {
        item["download_state"] = "pause";
    }
}


function download_change() {
    var download_process = 0;
    var download_num = 0;
    for (let key in downloadData) {
        var item = downloadData[key]
        if (item.download_state == "play") {
            download_process += Number((item.download_progress / item.fileSize).toFixed(2));
            download_num++;
        }
    }
    App_Browser_Win_list.forEach((win) => {
        var text = ((download_process / download_num).toFixed(2) * 100).toString()
        var index = text.indexOf('.')
        // console.log(download_process+"---"+download_num)
        var process_num = index == -1 ? text + "%" : text.slice(0, index) + "%"
        if (download_num == 0) {
            win.webContents.send('download-manage', "done", 0)
            win.setProgressBar(-1)
        } else {
            download_num = download_num > 99 ? "99+" : download_num;
            win.webContents.send('download-manage', process_num, download_num)
            var p = (download_process / download_num).toFixed(2)
            if (p == 0) { p = 0; }
            win.setProgressBar(Number(p));
        }
    });

    nodeStorage.setItem('downloadData', downloadData);
}

app.on('session-created', (session) => {
    session.on('will-download', (e, item, contents) => {

        // var file_name = item.getFilename();
        // var last_len = file_name.lastIndexOf(".");
        // var len = file_name.length;
        // var pathf = file_name.substring(last_len, len).toLowerCase();
        // if(pathf === ".pdf"){
        //     [...App_Browser_Win_list][0].send('open-file',item.getURL(),pathf)
        //     return ;
        // }

        if (is_download_user_tip) {

        } else {
            item.setSavePath(download_save_path + item.getFilename())
        }
        var date = new Date();

        var download_id = uuid.v4()
        downloadData[download_id] = {
            fileName: item.getFilename(),
            fileSize: item.getTotalBytes(),
            download_progress: item.getReceivedBytes(),
            date: date,
            download_path: download_save_path,
            url: item.getURL(),
            item: item,
            download_state: "play"
        }
        notice('下载管理器', "开始下载文件" + item.getFilename(), "fad fa-download");



        item.on('updated', (event, state) => {
            if (state === 'interrupted') {
                downloadData[download_id]["download_state"] = "pause";
            } else if (state === 'progressing') {
                if (item.isPaused()) {
                    downloadData[download_id]["download_state"] = "pause";
                } else {
                    downloadData[download_id]["download_progress"] = item.getReceivedBytes();
                }
            }
            download_change();
        })
        item.once('done', (event, state) => {
            if (state === 'completed') {
                downloadData[download_id]["download_state"] = "success";
                downloadData[download_id]["download_progress"] = item.getReceivedBytes();
                notice('下载管理器', "文件" + item.getFilename() + "下载完成", "fad fa-check-circle");
            } else {
                // console.log(`Download failed: ${state}`)
                downloadData[download_id]["download_state"] = "state";
                notice('下载管理器', "文件" + item.getFilename() + "下载出错", "fad fa-exclamation-triangle");
            }
            download_change();
        })
        //   let hostWebContents = contents;
        //   if (contents.getType() === 'webview') {
        //     const hostWebContents = contents.hostWebContents;
        //   }
        //   const hostWin = BrowserWindow.fromWebContents(hostWebContents);
    });
});
function createBrowserWindow(file_path = undefined) {
    if (winState === undefined) {
        try { winState = nodeStorage.getItem('winState') || {}; } catch (err) { }
    }
    let App_Browser_Win = new BrowserWindow({
        title: AppName,
        x: winState.bounds && winState.bounds.x || undefined,
        y: winState.bounds && winState.bounds.y || undefined,
        width: winState.bounds && winState.bounds.width || 1100,
        height: winState.bounds && winState.bounds.height || 720,
        minWidth: 500,
        minHeight: 400,
        /*skipTaskbar: true,*/
        frame: false,
        resizable: true,
        maximizable: true,
        minimizable: true,
        backgroundColor: "#000",
        // autoHideMenuBar:true,
        // transparent: true,
        // icon: "./app/imgs/logo.ico",
        show: true,
        // preload: path.join(__dirname, '/app/index.js'),
        // alwaysOnTop: false,
        webPreferences: {
            nodeIntegration: true,
            experimentalFeatures: false,
            webviewTag: true,
            nativeWindowOpen: false,
            // offscreen: false,
            plugins: true
        }
    });


    App_Browser_Win.webContents.on("new-window", function (e) {
        console.log("新窗口")
    })
    App_Browser_Win_list.add(App_Browser_Win)
    if (winState && winState.isMaximized) {
        App_Browser_Win.maximize();
    }
    var storeWindowState = function () {
        winState.isMaximized = App_Browser_Win.isMaximized();
        if (!winState.isMaximized) {
            winState.bounds = App_Browser_Win.getBounds();
        }
        // nodeStorage.setItem('winState', winState);
    };
    ['resize', 'move', 'close'].forEach(function (e) {
        App_Browser_Win.on(e, function () {
            storeWindowState();
        });
    });
    // move 很卡
    // ['resize', 'move', 'close'].forEach(function (e) {
    //     App_Browser_Win.on(e, function () {
    //         storeWindowState();
    //     });
    // });


    App_Browser_Win.once('ready-to-show', () => {
        let hwnd = App_Browser_Win.getNativeWindowHandle()
        // user32.GetSystemMenu(hwnd.readUInt32LE(0), true)
        // App_Browser_Win.show();
        // if (isArgs) {
        //     isArgs = false;
        //     // console.log(process.argv);
        //     var data = handleArgv(process.argv);
        //     if (data == "") { } else if (typeof data == "string") {
        //         var last_len = data.lastIndexOf(".");
        //         var len = data.length;
        //         var pathf = data.substring(last_len, len).toLowerCase();
        //         [...App_Browser_Win_list][0].send('open-file', "file://" + data, "this", pathf)
        //         // console.log("open-file");
        //     } else {
        //         opSet(process.argv)
        //     }
        // }

    })


    // and load the index.html of the app.
    App_Browser_Win.loadURL(url.format({
        pathname: path.join(__dirname, '/app/index.html'),
        protocol: 'file:',
        slashes: true
    }));

    // var ses = App_Browser_Win.webContents.session;
    // console.log(ses)
    App_Browser_Win.webContents.send('toggle-theme', browser_theme);


    App_Browser_Win.on("blur", () => {
        try {
            globalShortcut.unregister("ESC")
            globalShortcut.unregister("F11")
            globalShortcut.unregister("F5");
            globalShortcut.unregister("Ctrl+=");
            globalShortcut.unregister("Ctrl+numadd");
            globalShortcut.unregister("Ctrl+-");
            globalShortcut.unregister("Ctrl+0");
        } catch (err) { }
    })
    App_Browser_Win.on("focus", () => {
        try {
            globalShortcut.register("ESC", () => {
                if (App_Browser_Win.isFocused()) {
                    if (App_Browser_Win.isFullScreen()) {
                        App_Browser_Win.setFullScreen(false);
                    }
                }
            })
            globalShortcut.register("F11", () => {
                if (App_Browser_Win.isFocused()) {
                    if (App_Browser_Win.isFullScreen()) {
                        App_Browser_Win.setFullScreen(false);
                    } else {
                        App_Browser_Win.setFullScreen(true);
                    }
                }
            })
            globalShortcut.register("F5", () => {
                if (App_Browser_Win.isFocused()) {
                    App_Browser_Win.webContents.send('reload-page')
                }
            }, true)
            globalShortcut.register("Ctrl+=", () => {
                if (App_Browser_Win.isFocused()) {
                    App_Browser_Win.webContents.send('zoom-in')
                }
            }, true)
            globalShortcut.register("Ctrl+-", () => {
                if (App_Browser_Win.isFocused()) {
                    App_Browser_Win.webContents.send('zoom-out')
                }
            }, true)
            globalShortcut.register("Ctrl+numadd", () => {
                if (App_Browser_Win.isFocused()) {
                    App_Browser_Win.webContents.send('zoom-in')
                }
            }, true)
            globalShortcut.register("Ctrl+0", () => {
                if (App_Browser_Win.isFocused()) {
                    App_Browser_Win.webContents.send('zoom-reset')
                }
            }, true)
        } catch (err) { }

    })

    App_Browser_Win.on('closed', () => { App_Browser_Win_list.delete(App_Browser_Win); })

}


function new_pdf_win(path = "") {
    var winState = {};
    try { winState = nodeStorage.getItem('winState') || {}; } catch (err) { }
    const pdf_win = new PDFWindow({
        width: winState.bounds && winState.bounds.width || 1100,
        height: winState.bounds && winState.bounds.height || 720,
        title: path
    })
    if (winState && winState.isMaximized) {
        pdf_win.maximize();
    }
    pdf_win.loadURL(path);
}

ipcMain.on('synchronous-message', function (event, arg) {
    var jsonData = JSON.parse(arg)

    switch (jsonData.type) {
        case "theme":
            browser_theme = jsonData.data;
            App_Browser_Win_list.forEach((item) => {
                item.webContents.send('toggle-theme', jsonData.data);
            });
            nodeStorage.setItem('browser_theme', jsonData.data);
            break
        case "new-window":
            createBrowserWindow();
            break
        case "load-theme":
            event.sender.send('toggle-theme', browser_theme);
            break
        case "open-pdf":
            new_pdf_win(jsonData.path);
            break
        case "msg-info":
            break
        case "":
            break
        default:
    }

    event.returnValue = "ok"
})
ipcMain.on('on-save-image', function (event) {
    event.sender.send('on-save-image', app.getPath("pictures"))
})


// 防止两次启动程序
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, argv, workingDirectory) => {
        if (process.platform === 'win32') {
            // App_Browser_Win_list.forEach((item, i, obj) => {
            //     item.webContents.send('DEBUG', argv.toString())
            // })
            var data = handleArgv(argv);
            // App_Browser_Win_list[0].send('open-file', "file://"+str)
            if (data == "") { createBrowserWindow() } else if (typeof data == "string") {
                var last_len = data.lastIndexOf(".");
                var len = data.length;
                var pathf = data.substring(last_len, len).toLowerCase();
                // [...App_Browser_Win_list][0].send('open-file', "file://" + data, "", pathf)
                if (pathf === ".pdf") {
                    new_pdf_win(data)
                } else if (pathf === ".html") {
                    [...App_Browser_Win_list][0].send('open-file', "file://" + data, "", pathf)
                } else {
                    createBrowserWindow()
                }
            } else {
                opSet(argv)
            }

        }
    })
}
//app.disableHardwareAcceleration();
app.on('ready', () => {
    // console.log("ready");
    // createBrowserWindow(true)
    // console.log(process.argv);
    BrowserWindow.addExtension("D:/NodeProject/Electron-browser-20200410/app/Extensions/jsonview/0.0.32.3_0");
    // BrowserWindow.addExtension("D:/NodeProject/Electron-browser-20200410/app/Extensions/office/134.193.207_0");

    console.log(BrowserWindow.getExtensions());
    var data = handleArgv(process.argv);
    if (data == "") { createBrowserWindow() } else if (typeof data == "string") {
        var last_len = data.lastIndexOf(".");
        var len = data.length;
        var pathf = data.substring(last_len, len).toLowerCase();
        if (pathf === ".pdf") {
            new_pdf_win(data);
        } else if (pathf === ".html") {
            createBrowserWindow();
            setTimeout(() => { [...App_Browser_Win_list][0].send('open-file', "file://" + data, "this", pathf) }, 1000);
        } else {
            createBrowserWindow()
        }
    } else {
        opSet(process.argv)
    }
})
app.on('window-all-closed', () => { nodeStorage.setItem('winState', winState); app.quit(); })
app.on('activate', () => { })




function setPath(exe_url) {
    regedit.putValue({
        reg_content: { // 设置注册表url调用electronApp
            'defaule': {
                value: "RoseBrowser", // 设置点击url的弹出框名字（表现不好）
                type: 'REG_DEFAULT'
            },
            'URL Protocol': {
                value: '',
                type: 'REG_SZ'
            },
            'path': {
                value: `${exe_url}`,
                type: 'REG_SZ'
            }
        },
        'HKLM\\SOFTWARE\\Classes\\electronAPP\\shell\\open\\command': {
            'defaule': {
                value: `"${exe_url}" "$1"`, // 需要唤起的应用程序路劲
                type: 'REG_DEFAULT'
            }
        }
    }, (putErr) => {
        // console.log(putErr)
    })
}
if (exe_url) { // 判断启动url是否正确（用户重新安装，并将安装目录修改）
    regedit.list(reg_content, (listErr, docData) => {
        if (listErr) {
            regedit.createKey(['HKLM\\SOFTWARE\\Classes\\electronAPP\\shell\\open\\command'], (createErr) => {
                if (!createErr) {
                    setPath(exe_url)
                }
            })
        } else {
            if (docData[reg_content].values.path.value !== url) {
                setPath(exe_url)
            }
        }
    })
}