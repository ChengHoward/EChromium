var electron = require("electron");
// var fs = require("fs");
// var urlRequire = require("url");
var ipc = electron.ipcRenderer;
// var webFrame = electron.webFrame;

// var _browser_zoomLevel = 0;
// var _browser_maxZoom = 4.0;
// var _browser_minZoom = -0.9;


// //zoomIn
// function zoomIn() {
//     if (_browser_maxZoom > _browser_zoomLevel) {
//         _browser_zoomLevel += 0.1;
//     }
//     webFrame.setZoomLevel(_browser_zoomLevel);
//     ipc.sendToHost(JSON.stringify({
//         "type": "zoom",
//         "data": _browser_zoomLevel
//     }))
// }
// function zoomOut() {
//     if (_browser_minZoom < _browser_zoomLevel) {
//         _browser_zoomLevel -= 0.1;
//     }
//     webFrame.setZoomLevel(_browser_zoomLevel);
//     ipc.sendToHost(JSON.stringify({
//         "type": "zoom",
//         "data": _browser_zoomLevel
//     }))
// }
// function zoomReset() {
//     _browser_zoomLevel = 0;
//     webFrame.setZoomLevel(_browser_zoomLevel);
//     ipc.sendToHost(JSON.stringify({
//         "type": "zoom",
//         "data": _browser_zoomLevel
//     }))
// }


// ipc.on("zoomIn", function () { zoomIn() });


// ipc.on("zoomOut", function () { zoomOut() });


// ipc.on("zoomReset", function () { zoomReset() });

// ipc.on("updateReset", function () {
//     ipc.sendToHost(JSON.stringify({
//         "type": "zoom",
//         "data": _browser_zoomLevel
//     }))
// });


// var ctrldown = false;
// var tempTime = null;
// ipc.on("ctrldown-true", function () {
//     ctrldown = true
//     try {
//         clearTimeout(tempTime)
//     } finally {

//     }
//     tempTime = setTimeout(() => {
//         ctrldown = false
//     }, 100);
// });
// ipc.on("ctrldown-false", function () {
//     ctrldown = false
// });



// $(document).keyup(function (event) {
//     if (event.ctrlKey) {
//         ctrldown = true
//     }
// });
// $(document).keydown(function (event) {
//     if (event.ctrlKey) {
//         ctrldown = false
//     }
// }); 

// document.onkeydown = function (e) {
//     if (e.key == "Control") {
//         ctrldown = true
//         if (tempTime != null) {
//             try {
//                 clearTimeout(tempTime)
//             } finally {

//             }
//         }
//         tempTime = setTimeout(() => {
//             ctrldown = false
//         }, 500);
//         console.log(ctrldown)
//     }
// }
// document.onkeyup = function (e) {
//     if (e.key == "Control") {
//         ctrldown = false
//         console.log(ctrldown)
//     }
// }

// var scrollFunc = function (e) {
//     e = e || window.event;
//     if (e.wheelDelta > 0) { //当滑轮向上滚动时
//         if (ctrldown) {
//             zoomIn()
//         }
//         console.log(ctrldown);
//     }
//     if (e.wheelDelta < 0) { //当滑轮向下滚动时
//         // console.log("滑轮向下滚动时")
//         if (ctrldown) {
//             zoomOut()
//         }
//         console.log(ctrldown);
//     }
// };
// window.onmousewheel = document.onmousewheel = scrollFunc;

// const xhrProxy = require('./scripts/xhr_proxy.js');

// xhrProxy.addHandler(function (xhr) {
//     let data = {};
//     //TODO 具体业务代码
//     //通过ipcRenderer.sendToHost即可将xhr内容发送到BrowserWindow中
//     console.log(xhr)
//     // ipc.sendToHost(JSON.stringify({
//     //     "type": "channel",
//     //     "data": xhr.response,
//     //     "status":xhr.status,
//     //     "responseURL":xhr.responseURL
//     // }));
//     var jsonData = JSON.parse(xhr.response)
//     if (jsonData.secretKey != undefined) {
//         ipc.sendToHost(JSON.stringify({
//             "type": "channel",
//             "data": JSON.parse(DES3.decrypt(jsonData.result, jsonData.secretKey))
//         }));
//     }
// })


/*URL	可选。打开指定的页面的URL。如果没有指定URL，打开一个新的空白窗口
name	可选。指定target属性或窗口的名称。支持以下值：
_blank - URL加载到一个新的窗口。这是默认
_parent - URL加载到父框架
_self - URL替换当前页面
_top - URL替换任何可加载的框架集
name - 窗口名称
specs	可选。一个逗号分隔的项目列表。支持以下值：

channelmode=yes|no|1|0	是否要在影院模式显示 window。默认是没有的。仅限IE浏览器
directories=yes|no|1|0	是否添加目录按钮。默认是肯定的。仅限IE浏览器
fullscreen=yes|no|1|0	浏览器是否显示全屏模式。默认是没有的。在全屏模式下的 window，还必须在影院模式。仅限IE浏览器
height=pixels	窗口的高度。最小.值为100
left=pixels	该窗口的左侧位置
location=yes|no|1|0	是否显示地址字段.默认值是yes
menubar=yes|no|1|0	是否显示菜单栏.默认值是yes
resizable=yes|no|1|0	是否可调整窗口大小.默认值是yes
scrollbars=yes|no|1|0	是否显示滚动条.默认值是yes
status=yes|no|1|0	是否要添加一个状态栏.默认值是yes
titlebar=yes|no|1|0	是否显示标题栏.被忽略，除非调用HTML应用程序或一个值得信赖的对话框.默认值是yes
toolbar=yes|no|1|0	是否显示浏览器工具栏.默认值是yes
top=pixels	窗口顶部的位置.仅限IE浏览器
width=pixels	窗口的宽度.最小.值为100

replace	Optional.Specifies规定了装载到窗口的 URL 是在窗口的浏览历史中创建一个新条目，还是替换浏览历史中的当前条目。支持下面的值：
true - URL 替换浏览历史中的当前条目。
false - URL 在浏览历史中创建新的条目。
// document.window

*/

//  window.open = window.opene
// window.open = function(url="about:blank",name="_blank",specs="",replace=""){
//     console.log(name)
//     if(name === "_blank"){
//         ipc.sendToHost(JSON.stringify({
//             "type": "new-tab",
//             "url": url
//         }))
//     }
// }
// console.log(window.open)

// document.getElementsByName("a").onclick(function(e){
//     // window.open(src,e);
//     console.log(e);
// })

// 页面访问
// console.log(window.location);
// console.log(document.window.location);

// window.webViewerOpenFileViaURL;
ipc.on("load-url", function (e,url) { window.location.href = url;console.log(url) });
// ipc.on("load-pdf", function (e,url) { window.webViewerOpenFileViaURL(url); });


