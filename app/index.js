

// 获取插件
var plugins_ = {
    "pdf": {
        "NAME": "PDF阅读",
        "JS_PATH": "file:///app/pdf.viewer/web/viewer.html",
        "JS_HOST": "app/pdf.viewer/web/viewer.html",
        "HREF": "howardbrowser://pdf-viewer",
        "HOST": "pdf-viewer",
        "JS_FILE": "/app/pdf.viewer/web/viewer.html",
        "ICON": '<i class="fad fa-file-pdf"></i>&ensp;PDF阅读',
        on: function (webview, file_path) {
            function run() {
                setTimeout(() => {
                    webview.send("load-pdf", file_path);
                }, 500);
            }
            return run
        },
        open: function (path = "") {
            ipcRenderer.send('synchronous-message', JSON.stringify({ "type": "open-pdf", "path": path }))
        }
    }
}
var plugins_has = {}
Object.keys(plugins_).forEach(function (key) { plugins_has[plugins_[key].HOST] = plugins_[key] });


//黑夜模式测试版
function theme_night_page(_webview) {
    // var key = _webview.insertCSS(`
    // *{
    //     background-color: transparent!important;
    //     color:#AFCCCD !important;
    // }
    // `)
}

//实现通知功能
var msg_flag = undefined;
function notice(title = "通知", content = "通知内容", icon = "fad fa-flag-checkered") {
    $MsgNotice = $("#info-msg");
    $MsgNotice_icon = $("#info-msg .info-msg-icon").attr("class", "info-msg-icon " + icon);
    $MsgNotice_title = $("#info-msg .info-msg-title").html(title);
    $MsgNotice_content = $("#info-msg .info-msg-content").html(content);

    $MsgNotice.show(200);
    if (msg_flag === undefined) { } else { msg_flag = undefined; clearTimeout(msg_flag); }
    msg_flag = setTimeout(() => {
        $MsgNotice.hide(200);
    }, 3000);
}


function handleUrl(urlStr) {
    // howardbrowser://pdf-viewer?path=D:\公司文件\模板\template.pdf
    const urlObj = new URL(urlStr);
    const { searchParams } = urlObj;
    return searchParams
}


function checkIP(value) {
    var exp = /^(25[0-5]|2[0-4][0-9]|[0-1]{1}[0-9]{2}|[1-9]{1}[0-9]{1}|[1-9]).(25[0-5]|2[0-4][0-9]|[0-1]{1}[0-9]{2}|[1-9]{1}[0-9]{1}|[1-9]|0).(25[0-5]|2[0-4][0-9]|[0-1]{1}[0-9]{2}|[1-9]{1}[0-9]{1}|[1-9]|0).(25[0-5]|2[0-4][0-9]|[0-1]{1}[0-9]{2}|[1-9]{1}[0-9]{1}|[0-9])$/;
    var reg = value.match(exp);
    if (reg == null) {
        return false;
    } else {
        return true;
    }
}
function pathf(text) {
    var last_len = text.lastIndexOf(".");
    var len = text.length;
    return text.substring(last_len, len).toLowerCase();
}

function checkURL(str_url) {
    var strRegex = '^((howardbrowser:|view-source:https|view-source:http|https|http|ftp|rtsp|mms)?://)'
        + '?(([0-9a-z_!~*().&=+$%-]+: )?[0-9a-z_!~*().&=+$%-]+@)?' //ftp的user@
        + '(([0-9]{1,3}.){3}[0-9]{1,3}' // IP形式的URL- 199.194.52.184
        + '|' // 允许IP和DOMAIN（域名）
        + '([0-9a-z_!~*()-]+.)*' // 域名- www.
        + '([0-9a-z][0-9a-z-]{0,61})?[0-9a-z].' // 二级域名
        + '[a-z]{2,6})' // first level domain- .com or .museum
        + '(:[0-9]{1,4})?' // 端口- :80
        + '((/?)|' // a slash isn't required if there is no file name
        + '(/[0-9a-z_!~*().;?:@&=+$,%#-]+)+/?)$';
    var re = new RegExp(strRegex);
    if (re.test(str_url)) {
        return (true);
    } else {
        return (false);
    }
}

var HomeUrl = "https://www.baidu.com/";
var searchUrl = "https://www.baidu.com/s?wd=";
var def_url = "about:blank";

var tab_num = 0;
var $BrowserContainer = $("#browser-container");
var $TabBar = $("#web-label-bar");
var $moreContainer = $("#more-container");
var $pageMsgContainer = $("#page-msg-container");
var $newTabBtn = $("#new-tab-btn");
var cur_tab = 0; //用来处理当前显示的标签页
var cur_webview; //用来处理当前显示的webview
var cur_pertab; //用来处理当前显示的perview
var cur_perview; //用来处理当前显示的perview
var $perview = $("#preview");
var title_plus = "&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;" +
    "&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;&ensp;"

// 实现自适应标签栏
function formatDecimal(num, decimal) {
    num = num.toString()
    let index = num.indexOf('.')
    if (index !== -1) {
        num = num.substring(0, decimal + index + 1)
    } else {
        num = num.substring(0)
    }
    return parseFloat(num).toFixed(decimal)
}
// 自适应标签栏附带方法

function tab_width_num() {
    var tabs = $TabBar.find(".web-label")
    if ($("body").width() - 285 >= (tabs.length) * 225) {
        tabs.css("max-width", "225px");
        $TabBar.css("width", "auto");
    } else {
        tabs.css("max-width", $TabBar.width() / tabs.length + "px");
    }
}

function tab_width_bfb() {
    setTimeout(() => {
        $TabBar.css("width", "auto");
        var tabs = $TabBar.find(".web-label");
        tabs.css("max-width", "calc(" + formatDecimal(100 / tabs.length, 10) + "%)");
    }, 200)
}


$TabBar.hover(function () {
    tab_width_num()
}, function () {
    tab_width_bfb()
})
$newTabBtn.hover(function () {
    $perview.hide();
}, function () {
})
$perview.hover(function () {
    tab_width_num();
}, function () {
    var tabs = $TabBar.find(".web-label");
    if ($("body").width() - 285 >= (tabs.length) * 225) {
        tabs.css("max-width", "225px");
        $TabBar.css("width", "auto");
    } else {
        tabs.css("max-width", $TabBar.width() / tabs.length + "px");
    }
    $TabBar.css("width", "auto");
    tabs.css("max-width", "calc(" + formatDecimal(100 / tabs.length, 10) + "%)");
})
function onAutoTab(type = "new") {
    var tabs = $TabBar.find(".web-label")
    if (type === "new") {
        if ($("body").width() - 285 >= (tabs.length + 1) * 225) {
            // tabs.css("max-width", "225px");
            // tabs.css("max-width", "calc(" + formatDecimal(100 / tabs.length, 10) + "%)")
            $TabBar.css("width", "auto");
            tabs.css("max-width", "calc(" + formatDecimal(100 / tabs.length, 10) + "%)")
        } else {
            // tabs.css("max-width", "calc(" + formatDecimal(100 / tabs.length, 10) + "%)")
            // tabs.css("max-width", ($("body").width() - 285) / tabs.length + "px")
            $TabBar.css("width", "auto");
            tabs.css("max-width", "calc(" + formatDecimal(100 / tabs.length, 10) + "%)")
        }
        setTimeout(() => { $TabBar.css("width", "auto"); }, 100);
    } else if (type === "last") {
        if ($("body").width() - 285 >= (tabs.length) * 225) {
            tabs.css("max-width", "225px");
            $TabBar.css("width", "auto");
        } else {
            tabs.css("max-width", $TabBar.width() / tabs.length + "px");
        }
    } else {
        if ($("body").width() - 285 >= (tabs.length) * 225) {
            tabs.css("max-width", "225px");
            $TabBar.css("width", "auto");
        } else {
            tabs.css("max-width", $TabBar.width() / tabs.length + "px");
        }
    }

}

// 点击新加标签栏按钮
$newTabBtn.click(() => {
    newTab(undefined, "active")
})
//设置窗口标题
function setTitle(title) {
    $("title").html(title);
}


// var _browser_zoomLevel = webview.getZoomFactor().toFixed(2);
var _browser_maxZoom = 5.0;
var _browser_minZoom = 0.25;

//修改当前webview的Zoom大小
function changeZoom() {
    $("#fn-zoom i").html(Math.trunc(cur_webview.zoomFactor.toFixed(2) * 100) + "%")
}
//当前webview的Zoom变大
function zoomIn() {
    if (_browser_maxZoom > cur_webview.zoomFactor) { cur_webview.zoomFactor = cur_webview.zoomFactor + 0.1; }
    changeZoom();
}
//当前webview的Zoom变小
function zoomOut() {
    if (_browser_minZoom < cur_webview.zoomFactor) { cur_webview.zoomFactor = cur_webview.zoomFactor - 0.1; }
    changeZoom();
}
//当前webview的Zoom还原
function zoomReset() {
    cur_webview.zoomFactor = 1;
    changeZoom();
}
//tab切换
function onTabToggle() {
    var title = cur_webview.getTitle();
    if (title == "about:blank") {
        title = "新标签页" + title_plus;
    }
    setTitle(title);
    changeZoom();
}

// 关闭标签页
function closeIndex(index) {
    var tabs = $TabBar.find(".web-label");
    var reStr = "close";
    if ($TabBar.children(".web-label:last-child").attr("web-id").toString() === index) {
        $TabBar.css("width", $TabBar.width() + "px");
        reStr = "last";
    } else {
        $TabBar.css("width", $TabBar.width() - tabs.width() + "px");
    }
    $perview.hide();
    if ($TabBar.find(".web-label").length == 1) {
        const window = remote.getCurrentWindow();
        window.destroy();
    } else {
        $TabBar.find("#tb-" + index).remove()
        $TabBar.find("#tb-" + index).empty().width(1);
        $BrowserContainer.find("#wbc-" + index).remove();
        var tabs = $TabBar.find(".web-label");
        if (cur_tab + "" == index + "") {
            var cur = $(tabs[tabs.length - 1]);
            cur.addClass("selectd");
            $BrowserContainer.find("#wbc-" + cur.attr("web-id")).show();
            cur_tab = cur.attr("web-id");
            cur_webview = document.querySelector("#wb-" + cur_tab);
            // onTabToggle()
        }
    }
    hidePreview();
    $perview.hide();
    onAutoTab(reStr)
}

// 实现perview栏功能
//隐藏tab预览
function hidePreview() {
    $perview.find(".tab-title").html("")
    $perview.find(".tab-url").html("")
}
var $tabCloseLeft = $("#tab-close-left");
var $tabCloseCur = $("#tab-close-cur");
var $tabCloseOther = $("#tab-close-other");
var $tabCloseRight = $("#tab-close-right");
var $tabCloseVolume = $("#tab-close-volume");
var $previewShowImg = $("#preview_show_img");

function close_left_tab(tab_id) {
    var prev = $("#tb-" + tab_id).prevAll();
    for (let index = 0; index < prev.length; index++) {
        const element = $(prev[index]);
        closeIndex(element.attr("web-id"));
    }
    onAutoTab();
}
function close_right_tab(tab_id) {
    var next = $("#tb-" + tab_id).nextAll();
    for (let index = 0; index < next.length; index++) {
        const element = $(next[index]);
        closeIndex(element.attr("web-id"));
    }
    onAutoTab();
}
$tabCloseLeft.click(function () {
    close_left_tab(cur_pertab);
})
$tabCloseCur.click(function () {
    closeIndex(cur_pertab);
})
$tabCloseOther.click(function () {
    close_left_tab(cur_pertab);
    close_right_tab(cur_pertab);
})
$tabCloseRight.click(function () {
    close_right_tab(cur_pertab);
})
$tabCloseVolume.click(function () {
    if (cur_perview.audioMuted) {
        cur_perview.audioMuted = false;
        $tabCloseVolume.find(".tab-fn-content").attr("将网页静音");
        $tabCloseVolume.find("i").attr("class", "fad fa-volume")
    } else {
        cur_perview.audioMuted = true;
        $tabCloseVolume.find(".tab-fn-content").attr("解除网页静音");
        $tabCloseVolume.find("i").attr("class", "fad fa-volume-slash")
    }
})

//新建标签方法
/**
 * 
 * @param {*} new_url 
 * @param {*} toggle "active"|新建标签栏并处于活动状态
 */
function newTab(new_url = undefined, toggle = "active") {
    $TabBar.find(".web-label").removeClass("selectd")
    $TabBar.append('<li style="display:none;" id="tb-' + tab_num + '" web-id="' + tab_num + '" class="web-label selectd">' +
        '<div class="left_radius"></div>' +
        '<div id="d-' + tab_num + '" web-id="' + tab_num + '" class="label-content"><img class="favicon" src="imgs/earth.png" onerror="this.src=\'imgs/earth.png\'"/></img>' +
        '<i class="fas fa-circle-notch fa-spin loading"></i>' +
        '<label>新标签页' + title_plus + '</label>' +
        '<span class="close-tab" web-id="' + tab_num + '"><i class="fal fa-times"></i><span></div>' +
        '<div class="center_radius"></div>' +
        '<div class="right_radius"></div>' +
        '<div class="tab-border"></div>' +
        '</li>')
    $BrowserContainer.find(".browser-content").hide();
    $BrowserContainer.append('<div class="browser-content" style="display:none" id="wbc-' + tab_num + '">' +
        '<div class="browser-tool">' +
        '<div class="browser-tool-btn back-btn dis" title="后退"><i class="icon fad fa-arrow-left"></i></div>' +
        '<div class="browser-tool-btn next-btn dis" title="前进"><i class="icon fad fa-arrow-right"></i></div>' +
        '<div class="browser-tool-btn reload-btn" title="刷新"><i class="icon fad fa-redo-alt"></i></div>' +
        '<div class="browser-tool-btn home-btn" title="首页"><i class="icon fad fa-home"></i></div>' +
        '<div class="addr-bar"><div class="browser-tool-btn"><img class="img" style="display:none;" src="imgs/earth.png"/><div class="bar-icon"></div></div><input class="text-content addr-text" /></div>' +
        '</div><webview preload="./preload.js" class="browser" id="wb-' + tab_num + '" web-id="' + tab_num + '" src="' + def_url + '" allowpopups></webview>' +
        '<div class="show_url" id="su-' + tab_num + '"></div></div>')


    var webview = document.querySelector('#wb-' + tab_num)
    // console.log($('#wb-' + tab_num + " .iframe"));
    //.localhost = "www.baidu.com";
    if (toggle == "active") {
        cur_tab = tab_num;
        cur_webview = document.querySelector("#wb-" + cur_tab);
        $('#tb-' + tab_num).show();
        $BrowserContainer.find("#wbc-" + tab_num).show();
    }
    // $('#wbc-' + web_id + ' .browser-tool .addr-text').val(decodeURI(new_url))

    // 页面查找功能
    $('#wbc-' + tab_num).append($("#search_page_template").html())
    var $search = $("#wbc-" + tab_num + " .search_container");
    var $search_text = $("#wbc-" + tab_num + " .search_container .search_text");
    var $search_up = $("#wbc-" + tab_num + " .search_container .search_up_btn");
    var $search_down = $("#wbc-" + tab_num + " .search_container .search_down_btn");
    var $search_close = $("#wbc-" + tab_num + " .search_container .search_close_btn");
    var $search_num = $("#wbc-" + tab_num + " .search_container .search_num");
    var search_text = "";
    var requestId;
    $search_text.keyup(function (e) {
        var text = $search_text.val()
        if (text.length) {
            if (e.keyCode == 13) {
                requestId = webview.findInPage(text)
            } else {
                if (search_text !== text) { requestId = webview.findInPage(text) }
            }
        } else {
            $search_num.hide();
            webview.stopFindInPage('keepSelection');
        }
        search_text = text;
        // console.log(text)
        // console.log(requestId)
    })
    $search_up.click(function () {
        var text = $search_text.val();
        webview.findInPage(text, { forward: false });
    })
    $search_down.click(function () {
        var text = $search_text.val()
        webview.findInPage(text, { forward: true });
    })
    $search_close.click(function () {
        $search.hide(200);
        webview.stopFindInPage("clearSelection");
        search_text = "";
    })
    webview.addEventListener('found-in-page', (e) => {
        $search_num.show().html(`${e.result.activeMatchOrdinal}/${e.result.matches}`);
    })

    onAutoTab()

    
    //监听切换事件
    var $tab = $("#tb-" + tab_num);
    var mouse_down_xx = 0;
    var tab_list = []
    $("#d-" + tab_num).mousedown(function () {
        $TabBar.find(".web-label").removeClass("selectd")
        $BrowserContainer.find(".browser-content").hide();
        $("#tb-" + $(this).attr("web-id")).addClass("selectd");
        $BrowserContainer.find("#wbc-" + $(this).attr("web-id")).show();
        cur_tab = $(this).attr("web-id");
        cur_webview = document.querySelector("#wb-" + cur_tab);
        onTabToggle()
    })
    $tab.mousedown((e) => {
        console.log("mousedown");
        console.log(e);
        // 按下鼠标时绑定鼠标移动事件
        var v = true;
        // $tab.css("transition", "0ms !important");
        $tab.on({
            mouseup:function(e){
                $tab.animate({ "left": "0" });
                // console.log("mouseup");
                // console.log(e);
                $tab.off("mousemove");
                $tab.off("mouseleave");
                $tab.off("mouseup");
            },
            mousemove: function (e) {
                var xx = e.originalEvent.x || e.originalEvent.layerX || 0;
                var yy = e.originalEvent.y || e.originalEvent.layerY || 0;
                if (v) { v = false; mouse_down_xx = xx; }
                $tab.css("left", xx - mouse_down_xx + "px");
                $perview.hide();
                // console.log($tab.css("left"));
                // console.log(mouse_down_xx - xx);
            },
            mouseleave: function (e) {
                $tab.animate({ "left": "0" });
                // console.log("hover");
                // console.log(e);
                $tab.off("mousemove");
                $tab.off("mouseleave");
                $tab.off("mouseup");
            }
        })
    })


    //监听关闭事件
    $("#d-" + tab_num + " .close-tab").click(function () {
        closeIndex($(this).attr("web-id"));
    })
    var web_id = tab_num;

    //绑定后退按钮
    $('#wbc-' + web_id + ' .back-btn').click(() => {
        if (webview.canGoBack()) {
            webview.goBack()
        }
    })
    //绑定前进按钮
    $('#wbc-' + web_id + ' .next-btn').click(() => {
        if (webview.canGoForward()) {
            webview.goForward()
        }
    })
    //绑定刷新和停止按钮
    $('#wbc-' + web_id + ' .reload-btn').click(() => {
        if (webview.isLoading()) {
            webview.stop()
        } else {
            webview.reload()
        }
    })
    //绑定主页按钮
    $('#wbc-' + web_id + ' .home-btn').click(() => {
        // while (webview.isLoading()) {
        //     webview.stop();
        // }
        if (webview.getURL() !== HomeUrl) {
            webview.send("load-url", HomeUrl);
        }
        // try { webview.loadURL(HomeUrl) } catch (err) { }

    })

    //监听tab宽度
    $('#tb-' + tab_num).resize(function () {
        var $wbl = $TabBar.find(".web-label");
        if ($wbl.width() < 30) {
            $TabBar.find(".web-label .close-tab").hide();
            $TabBar.find(".web-label").addClass("hide-icon");
            $TabBar.find(".web-label").removeClass("auto-hide-icon");
        } else if ($wbl.width() < 65) {
            // $(this).find(".close-tab").hide();
            // $(this).addClass("auto-hide-icon");
            // console.log($(this).width());
            $TabBar.find(".web-label .close-tab").hide();
            $TabBar.find(".web-label").addClass("auto-hide-icon");
            $TabBar.find(".web-label").removeClass("hide-icon");
        } else {
            // $(this).find(".close-tab").show();
            // $(this).removeClass("auto-hide-icon");
            $TabBar.find(".web-label .close-tab").show();
            $TabBar.find(".web-label").removeClass("hide-icon");
            $TabBar.find(".web-label").removeClass("auto-hide-icon");
        }
    })

    //显示tab预览
    function showPreview($tab) {
        cur_pertab = $tab.attr("web-id");
        $perview.css("left", $tab.offset().left + "px");
        $perview.css("width", "225px");
        $perview.find(".tab-title").html(webview.getTitle());
        $perview.find(".tab-url").html(urlRequire.parse(webview.getURL()).host);
        cur_perview = document.querySelector("#wb-" + cur_pertab);
        if (cur_perview.audioMuted) {
            $tabCloseVolume.find(".tab-fn-content").attr("解除网页静音");
            $tabCloseVolume.find("i").attr("class", "fad fa-volume-slash")
        } else {
            $tabCloseVolume.find(".tab-fn-content").attr("将网页静音");
            $tabCloseVolume.find("i").attr("class", "fad fa-volume")
        }
        //页面预览功能，暂时不适用
        // if(cur_tab == cur_pertab){
        //     $previewShowImg.hide();
        // } else{
        //     $previewShowImg.show();
        //     $previewShowImg.attr("src", "");
        //     cur_perview.capturePage().then(image => {
        //         const base64 = image.toDataURL();
        //         $previewShowImg.attr("src", base64);
        //     });
        // }


        $perview.show()
    }



    $('#tb-' + tab_num).hover(function () {
        // showPreview($(this).offset().left + "px", $(this).width - 30 + "px");
        showPreview($(this));
    }, function () {
        // hidePreview();
    })
    $(".web-label-container").hover(function () {
    }, function () {
        $perview.hide(200);
    })

    function ToURL(text) {
        var search = text;
        // console.log(text);
        var { protocol, host, href, query, hostname, pathname } = urlRequire.parse(text);
        // console.log(urlRequire.parse(text))
        switch (protocol) {
            case "howardbrowser:":
                plugins_has[host].open();
                break;
            case "file:":
                // try { fs.statSync(`${hostname}://${pathname}`)} catch (err) {
                //     console.log(urlRequire.parse(text));
                //     console.log(err);
                //     remote.dialog.showErrorBox('错误', '文件不存在！');
                //     return;
                // }
                switch (pathf(text)) {
                    case ".pdf":
                        webview.loadURL(text);
                        // plugins_.pdf.open(text);
                        break;
                    case ".html":
                        webview.loadURL(text);
                        break;
                    case "":
                        break;
                    default:
                        webview.loadURL(text);
                }
                //file://D:\公司文件\模板\template1.pdf
                // webview.loadURL(text);
                break;
            case "about:":
                webview.send("load-url", text);
                break;
            case "chrome:":
                webview.loadURL(text);
                break;
            case "http:":
                webview.loadURL(text);
                break;
            case "https:":
                webview.loadURL(text);
                break;
            case "view-source:":
                webview.loadURL(text);
                break;
            default:
                webview.loadURL(searchUrl + search);
        }
        return
    }
    // 点击地址栏后的全选功能
    var iFocus = false;
    $('#wbc-' + web_id + ' .browser-tool .addr-text').click(() => {
        if (iFocus) {
            iFocus = false;
            $(this).select();
        }
    }).focus(() => {
        iFocus = true;
    }).blur(() => {

    }).keydown(function (e) {
        var text = $(this).val().trim();
        var search = $(this).val().trim();
        if (e.ctrlKey && e.which == 13) {
        }
        if (e.keyCode == 13) {
            ToURL(text)
        }
    });

    webview.addEventListener('new-window', (e, url, frameName, disposition, options, additionalFeatures) => {
        var protocol = urlRequire.parse(e.url).protocol;
        // if (e.frameName == "") {
        //     if (protocol === 'http:' || protocol === 'https:' || e.url === "about:blank") {
        //         // webview.src = e.url;
        //         newTab("active", e.url)
        //     }
        // } else if (e.frameName == "") {
        //     // console.log(e.frameName)
        // }
        // console.log(e);
        switch (e.disposition) {
            case "foreground-tab":
                newTab(e.url, "active");
                break;
            case "new-window":
                break;
            default:
                newTab(e.url, "active");
                break;
        }
    });
    //标题加载
    webview.addEventListener('dom-ready', (e) => {
        console.log("标题加载" + web_id);
        var tab = $TabBar.find("#tb-" + web_id)
        var title = document.getElementById('wb-' + web_id).getTitle()
        if (title == "about:blank") {
            title = "新标签页" + title_plus
        }
        tab.find("label").html(title + title_plus)
        if (cur_tab.toString() == web_id.toString()) {
            setTitle(title);
        }
        // webview.openDevTools();
    });
    //图标加载
    webview.addEventListener('page-favicon-updated', (e) => {
        // console.log("图标加载" + web_id);
        var tab = $TabBar.find("#tb-" + web_id)
        if (e.favicons.length >= 1) {
            tab.find(".favicon").attr("src", e.favicons[0])
                .css("border-radius", "0%")
            // .show()
        }
    });
    //开始加载事件
    webview.addEventListener('did-start-loading', (e) => {
        // console.log("开始加载事件" + web_id);
        var tab = $TabBar.find("#tb-" + web_id)
        tab.find(".favicon")
        attr("src", "imgs/earth.png")
            // .hide()
            .css("border-radius", "50%");


        tab.find(".loading").show()


        $('#wbc-' + web_id + ' .reload-btn i').removeClass("fa-redo-alt")
        $('#wbc-' + web_id + ' .reload-btn i').addClass("fa-times").css("font-size", "20px")
        $('#wbc-' + web_id + ' .reload-btn').attr("title", "停止");
        onTabToggle();
    });
    //停止加载事件
    webview.addEventListener('did-stop-loading', (e) => {
        console.log("停止加载事件" + web_id);
        // var key = theme_night_page(webview); //黑夜模式测试代码
        //新页面加载
        if (new_url !== undefined) {
            ToURL(new_url);
            new_url = undefined;
            webview.clearHistory();
        }
        var tab = $TabBar.find("#tb-" + web_id)
        tab.find(".favicon").show()
        tab.find(".loading").hide()

        $('#wbc-' + web_id + ' .reload-btn i').removeClass("fa-times")
        $('#wbc-' + web_id + ' .reload-btn i').addClass("fa-redo-alt").css("font-size", "")
        $('#wbc-' + web_id + ' .reload-btn').attr("title", "刷新")

        if (webview.canGoBack()) {
            $('#wbc-' + web_id + ' .back-btn').removeClass("dis")
        } else {
            $('#wbc-' + web_id + ' .back-btn').addClass("dis")
        }
        if (webview.canGoForward()) {
            $('#wbc-' + web_id + ' .next-btn').removeClass("dis")
        } else {
            $('#wbc-' + web_id + ' .next-btn').addClass("dis")
        }
        onTabToggle();
    });
    //当网页全屏时
    webview.addEventListener('enter-html-full-screen', (e) => {
        var tab = $TabBar.find("#tb-" + web_id)
        const window = remote.getCurrentWindow();
        $pageMsgContainer.show().html('按<span class="key">Esc</span>即可退出全屏模式')
    });
    //当网页退出全屏时
    webview.addEventListener('leave-html-full-screen', (e) => {
        var tab = $TabBar.find("#tb-" + web_id)
        const window = remote.getCurrentWindow();
    });
    //在导航加载完成时触发
    webview.addEventListener('did-finish-load', (e) => {
        // console.log("did-finish-load")
    });
    //加载失败时触发
    webview.addEventListener('did-fail-load', (e, errorDescription, validatedURL) => {
        // console.log("加载错误")
        // console.log(e)
        // console.log(e.errorDescription)
        // console.log(e.validatedURL)
    });
    //加载失败时触发
    webview.addEventListener('did-frame-finish-load', (isMainFrame) => {
        // console.log(isMainFrame)
    });
    //在渲染进程崩溃的时候触发.
    webview.addEventListener('crashed', () => {
        console.log("在渲染进程崩溃的时候触发.")
    });
    //加载失败时触发
    webview.addEventListener('gpu-crashed', () => {
        console.log("在GPU进程崩溃的时候触发.")
    });
    //在插件进程崩溃的时候触发.
    webview.addEventListener('plugin-crashed', () => {
        console.log("在插件进程崩溃的时候触发.")
    });
    //在媒体准备播放的时候触发
    webview.addEventListener('media-started-playing', (e) => {
        console.log("在媒体准备播放的时候触发");
        // console.log(e);
    });
    //在媒体暂停播放或播放放毕的时候触发
    webview.addEventListener('media-paused', (e) => {
        console.log("在媒体暂停播放或播放放毕的时候触发");
        // console.log(e);
    });
    //页面主题颜色更改时发出。
    webview.addEventListener('did-change-theme-color', (e) => {
        console.log(e.themeColor);
        // console.log(e);
    });


    setTimeout(() => {
        console.log(webview.getWebContents())
        webview.getWebContents().on('certificate-error', (e) => {
            console.log('certificate-error');
            console.log(e);
        });
        webview.getWebContents().on('select-client-certificate', (e) => {
            console.log('select-client-certificate');
            console.log(e);
        });
    }, 1000)

    var hasTargetUrl = undefined;
    //当鼠标滑到，或者键盘切换到a连接时，触发该事件。
    webview.addEventListener('update-target-url', (e) => {
        // console.log(e.url);
        if (hasTargetUrl !== undefined) {
            clearTimeout(hasTargetUrl);
            hasTargetUrl = undefined;
        }
        var $su = $("#su-" + cur_tab)
        if (e.url === "") {
            $su.hide();
        } else {
            $su.css("max-width", "30%");
            $su.html(e.url);
            $su.show();
            hasTargetUrl = setTimeout(function () {
                $su.css("max-width", "");
                hasTargetUrl = undefined;
            }, 1400)
        }
    });

    var $addr_icon_img = $('#wbc-' + web_id + ' .browser-tool .addr-bar .browser-tool-btn .img');
    var $addr_text = $('#wbc-' + web_id + ' .browser-tool .addr-bar .browser-tool-btn .bar-icon');
    var $addr_icon = $('#wbc-' + web_id + ' .browser-tool .addr-bar .browser-tool-btn .bar-icon');

    $addr_text.resize(function () {
        // console.log($addr_text.width() + 15 + "px");
        $('#wbc-' + web_id + ' .browser-tool .addr-text').css("padding-left", $addr_text.width() + 18 + "px")
    })

    function updateUrl(urlText) {
        var { protocol, host, href, query, path } = urlRequire.parse(urlText);
        if (protocol == "file:") {
            console.log(path)
            var plugins = plugins_has[path]
            if (plugins !== undefined) {
                urlText = plugins.HOST;
                $addr_icon.html(plugins.ICON);
            }
        }

        $addr_icon.show();
        $addr_icon_img.hide();
        if (urlText.substr(0, 7).toLowerCase() == "http://") {
            $addr_icon.html('<i class="far fa-exclamation-circle"></i>&ensp;不安全')
        } else if (urlText.substr(0, 8).toLowerCase() == "https://") {
            $addr_icon.html('<i class="fad fa-lock"></i>')
        } else if (urlText.substr(0, 7).toLowerCase() == "file://") {
            $addr_icon.html('<i class="fad fa-file"></i>&ensp;文件')
        } else if (urlText.substr(0, 7).toLowerCase() == "ftp://") {
            $addr_icon.html('<i class="fas fa-project-diagram"></i>&ensp;FTP')
        } else if (urlText.substr(0, 19).toLowerCase() == "view-source:http://") {
            $addr_icon.html('<i class="fad fa-code"></i>&ensp;源码')
        } else if (urlText.substr(0, 20).toLowerCase() == "view-source:https://") {
            $addr_icon.html('<i class="fad fa-code"></i>&ensp;源码')
        } else if (protocol == "about:") {
            $addr_icon.hide();
            $addr_icon_img.show();
        }

        $('#wbc-' + web_id + ' .browser-tool .addr-text').val(decodeURI(urlText))
    }


    webview.addEventListener('will-navigate', (e) => {
        updateUrl(e.url)
    });
    webview.addEventListener('did-navigate', (e) => {
        updateUrl(e.url)
    });
    webview.addEventListener('did-navigate-in-page', (e) => {
        var title = document.getElementById('wb-' + web_id)
        // console.log("did-navigate-in-page")
        // console.log(e)
        updateUrl(e.url)
    });

    // document.querySelector("#wbc-" + cur_tab).setZoomFactor(300)


    //在 guest page试图关闭自己的时候触发.
    webview.addEventListener('close', function () {
        closeIndex($(this).attr("web-id"))
        webview.src = 'about:blank';
    });

    webview.addEventListener('ipc-message', function (event) {
        // Prints "pong"
        var jsonData = JSON.parse(event.channel)
        if (jsonData.type == "channel") {
            console.log(jsonData)
        } else if (jsonData.type == "new-tab") {
            newTab(jsonData.url, "active")
        }
    });


    tab_num++;
    return {
        webview: webview,
        ToURL, ToURL
    };
}
// $("#card #back").gradientify({
//     gradients: [
//         { start: [49, 76, 172], stop: [242, 159, 191] },
//         { start: [255, 103, 69], stop: [240, 154, 241] },
//         { start: [33, 229, 241], stop: [235, 236, 117] }
//     ]
// });
// $('#ckLine').ckLine({
//     leftRight: false,
//     strokeColor: 'rgba(255,255,255,0.4)',
//     interval: 800,
//     animateTime: 1600,
//     animationTimeRange: [800, 1600]
// });

// const remote = nodeRequire.remote;
//var user32 = remote.nodeRequire('./app/scripts/user32').user32;

const winBrowser = remote.getCurrentWindow();
var btn_max = $(".sys-btn-max");
var btn_minis = $(".sys-btn-mini");
var btn_closes = $(".sys-btn-close");
var btn_more = $(".sys-btn-more");
var btn_close_more = $(".close-more");


function windowMaximize() {
    btn_max.find("i").addClass("fa-window-restore")
    btn_max.find("i").removeClass("fa-window-maximize")
    btn_max.attr("title", "还原")
}
function windowUnMaximize() {
    btn_max.find("i").addClass("fa-window-maximize")
    btn_max.find("i").removeClass("fa-window-restore")
    btn_max.attr("title", "最大化")
}

//窗口初始化时检查
if (winBrowser.isMaximized()) {
    windowMaximize();
    $("#card").addClass("win-max");
} else {
    windowUnMaximize();
    $("#card").removeClass("win-max");
}


//当窗口最大化时间调用
winBrowser.on('maximize', () => {
    windowMaximize();
    $("#card").addClass("win-max");
    onAutoTab();
})

//当窗口卸载最大化时间调用
winBrowser.on('unmaximize', () => {
    windowUnMaximize();
    $("#card").removeClass("win-max");
    onAutoTab();
})
//在调整窗口大小之前发出
winBrowser.on('will-resize', () => { })
//调整窗口大小后触发
winBrowser.on('resize', () => { })

//当窗口全屏时调用
winBrowser.on('enter-full-screen', () => {
    $(".window-title").addClass("window-title-hide")
    $(".browser-container").addClass("browser-container-hide")
    $pageMsgContainer.show().html('按<span class="key">F11</span>即可退出全屏模式')
    setTimeout(() => {
        $pageMsgContainer.hide()
    }, 3000)
})
//当窗口退出全屏时调用
winBrowser.on('leave-full-screen', () => {
    $(".window-title").removeClass("window-title-hide")
    $(".browser-container").removeClass("browser-container-hide")
    $pageMsgContainer.hide()
})

winBrowser.on('minimize', () => {
})

for (var i = 0; i < btn_minis.length; i++) {
    btn_minis[i].addEventListener("click", function (e) {
        winBrowser.minimize();
    });
}
for (var i = 0; i < btn_max.length; i++) {
    btn_max[i].addEventListener("click", function (e) {
        if (winBrowser.isMaximized()) {
            winBrowser.unmaximize();
        } else {
            winBrowser.maximize();
        }
    });
}


for (var i = 0; i < btn_closes.length; i++) {
    btn_closes[i].addEventListener("click", function (e) {
        winBrowser.destroy();
        //var hwnd = window.getNativeWindowHandle();
        //user32.DestroyWindow(hwnd.readUInt32LE());
    });
}

//more-container 显示/隐藏操作
function moreShow() {
    $moreContainer.show();
    btn_close_more.show();
    btn_more.addClass("sys-btn-selectd");
}
function moreHide() {
    $moreContainer.hide();
    btn_close_more.hide();
    btn_more.removeClass("sys-btn-selectd");
}
function toggleShow() {
    $moreContainer.toggle();
    btn_close_more.toggle();
    btn_more.toggleClass("sys-btn-selectd");
}


for (var i = 0; i < btn_more.length; i++) {
    btn_more[i].addEventListener("click", function (e) {
        toggleShow();
    });
}
for (var i = 0; i < btn_close_more.length; i++) {
    btn_close_more[i].addEventListener("click", function (e) {
        moreHide();
    });
}

//加载fn菜单
var fns = [
    {
        name: "窗口",
        id: "0",
        data: [
            {
                "name": "新标签页",
                "icon": "fad fa-tags",
                "title": "新标签页",
                "show": "新标签页",
                "id": "new-tab",
                "on": function () {
                    newTab(undefined, "active")
                    moreHide();
                },
                "reg": function () {
                }
            },
            {
                "name": "新窗口",
                "icon": "fad fa-window",
                "title": "新窗口",
                "show": "新窗口",
                "id": "new-window",
                "on": function () {
                    ipcRenderer.send('synchronous-message', JSON.stringify({ "type": "new-window", "data": "" }))
                    moreHide();
                },
                "reg": function () {
                }
            },
            {
                "name": "下载内容",
                "icon": "fad fa-download",
                "title": "下载内容",
                "show": "下载内容",
                "id": "download",
                "on": function () {
                    moreHide();
                },
                "reg": function () {
                    ipcRenderer.on('download-manage', function (e, download_process, download_num) {
                        if (download_process == "done") {
                            $("#download_num").hide(200).html(0)
                            $("#fn-download .i").html("").css("font-size", "").attr("class", "i fad fa-download");
                            $("#fn-download p").html("下载内容");
                        } else {
                            $("#download_num").show(200).html(download_num)
                            $("#fn-download .i").html(download_process).css("font-size", "14px").attr("class", "i");
                            $("#fn-download p").html("正在下载");
                        }
                    })
                    $("#fn-download").append("<i id='download_num' class='badge'>0</i>");
                }
            },
            {
                "name": "页面捕获",
                "icon": "fad fa-image-polaroid",
                "title": "页面捕获",
                "show": "页面捕获",
                "id": "page_img",
                "on": function () {
                    // var rect = cur_webview.capturePage();
                    // console.log(rect)
                    // $("#show_img").attr("src",rect.toDataURL());
                    cur_webview.capturePage().then(image => {
                        const base64 = image.toDataURL();
                        // console.log(base64)
                        // $("#show_img").attr("src", base64);
                        // 写入本地文件
                        const buffer = image.toPNG();
                        ipcRenderer.send('on-save-image')
                        ipcRenderer.on('on-save-image', function (event, path) {
                            var t1 = Date.now();
                            var file_path = path + "\\" + "浏览器屏幕截图-" + t1 + ".png";
                            fs.open(file_path, 'w', (err, fd) => {
                                if (err) throw err;
                                fs.write(fd, buffer, (err, bytes) => {
                                    if (err) throw err;
                                    notice("页面截图", "页面截图已保存到" + file_path, "fad fa-image-polaroid");
                                    // console.log(`write ${bytes}B to ${tmpFile}`);
                                })
                            });
                        })
                    });
                    moreHide();

                },
                "reg": function () {
                }
            },
        ]
    },
    {
        name: "页面",
        id: "1",
        data: [
            {
                "name": "打印...",
                "icon": "fad fa-print",
                "title": "打印...",
                "show": "打印...",
                "id": "0",
                "on": function () {
                    cur_webview.getWebContents().print()
                    moreHide();
                },
                "reg": function () {
                }
            },
            {
                "name": "在页面上查找...",
                "icon": "fad fa-search",
                "title": "在页面上查找...",
                "show": "查找...",
                "id": "2",
                "on": function () {
                    var $search = $("#wbc-" + cur_tab + " .search_container");
                    $search.toggle(200);
                    $search.find(".search_text").focus();
                    moreHide();
                },
                "reg": function () {
                }
            },

            {
                "name": "全屏浏览",
                "icon": "fad fa-expand",
                "title": "全屏浏览",
                "show": "全屏浏览",
                "id": "3",
                "on": function () {
                    const winBrowser = remote.getCurrentWindow();
                    winBrowser.setFullScreen(true);
                    moreHide();
                },
                "reg": function () {
                    // mousetrap.bind("F11", () => {
                    //     if (winBrowser.isFullScreen()) {
                    //         winBrowser.setFullScreen(false);
                    //     } else {
                    //         winBrowser.setFullScreen(true);
                    //     }
                    // })
                }
            }
        ]
    },

    {
        name: "缩放",
        id: "2",
        data: [
            {
                "name": "减少缩放量",
                "icon": "fa fa-minus",
                "title": "减少缩放量",
                "show": "减少缩放量",
                "id": "zoomOut",
                "on": function () {
                    zoomOut();
                },
                "reg": function () {
                }
            },
            {
                "name": "缩放比",
                "iconText": "100%",
                "iconStyle": "font-size: 18px",
                "title": "缩放比",
                "show": "缩放比",
                "id": "zoom",
                "on": function () {
                    zoomReset();

                },
                "reg": function () {

                    ipcRenderer.on('zoom-in', function () {
                        zoomIn();
                    })

                    ipcRenderer.on('zoom-out', function () {
                        zoomOut();
                    })

                    ipcRenderer.on('zoom-reset', function () {
                        zoomReset();
                    })

                }
            },
            {
                "name": "增加缩放量",
                "icon": "fa fa-plus",
                "title": "增加缩放量",
                "show": "增加缩放量",
                "id": "zoomIn",
                "on": function () {
                    zoomIn();

                },
                "reg": function () {
                }
            }
        ]
    },
    {
        name: "样式",
        id: "3",
        data: [
            {
                "name": "黑夜模式",
                "icon": "fad fa-moon",
                "title": "黑夜模式",
                "show": "黑夜模式",
                "id": "n-light",
                "on": function () {
                    var $theme = $("#theme-css")
                    ipcRenderer.on('synchronous-reply', (event, arg) => {  //渲染进程接收主进程响应回来的处理结果
                    })
                    if ($theme.attr("href") == "theme/light.css") {
                        ipcRenderer.send('synchronous-message', JSON.stringify({ "type": "theme", "data": "night" }))
                    } else if ($theme.attr("href") == "theme/night.css") {
                        ipcRenderer.send('synchronous-message', JSON.stringify({ "type": "theme", "data": "light" }))
                    }
                },
                "reg": function () {
                    function theme_toggle(theme_name) {
                        if (theme_name == "night") {
                            $theme.attr("href", "theme/night.css");
                            $("#fn-n-light i").attr("class", "fad fa-sun");
                            $("#fn-n-light p").html("亮色模式");
                        } else if (theme_name == "light") {
                            $theme.attr("href", "theme/light.css");
                            $("#fn-n-light i").attr("class", "fad fa-moon");
                            $("#fn-n-light p").html("黑夜模式");
                        }
                    }
                    ipcRenderer.on('load-theme', function (event, arg) {
                        const message = `异步消息回复: ${arg}`
                    })

                    var $theme = $("#theme-css");
                    // theme_toggle();
                    ipcRenderer.send('synchronous-message', JSON.stringify({ "type": "load-theme", "data": "" }))
                    ipcRenderer.on('toggle-theme', (event, theme_name) => {
                        theme_toggle(theme_name)
                    })
                }
            }, {
                "name": "开发者工具",
                "icon": "fab fa-dev",
                "title": "开发者工具",
                "show": "开发者工具",
                "id": "open-dev",
                "on": function () {
                    if (cur_webview.isDevToolsOpened()) {
                        cur_webview.closeDevTools();
                    } else {
                        cur_webview.openDevTools();
                    }

                },
                "reg": function () {
                }
            }
        ]
    },
]

for (let c in fns) {
    $moreContainer.append('<ul class="more-content" id="fnc-' + fns[c].id + '"></ul>')

    for (let fn in fns[c].data) {
        if (fns[c].data[fn].icon == undefined) {
            $("#fnc-" + fns[c].id).append('<li class="fn" title="' + fns[c].data[fn].title + '">' +
                '<div class="fn-container" id="fn-' + fns[c].data[fn].id + '">' +
                '<i class="i" style="' + fns[c].data[fn].iconStyle + '">' + fns[c].data[fn].iconText + '</i>' +
                '<p>' + fns[c].data[fn].show + '</p>' +
                '</div>' +
                '</li>')
        } else {
            $("#fnc-" + fns[c].id).append('<li class="fn" title="' + fns[c].data[fn].title + '">' +
                '<div class="fn-container" id="fn-' + fns[c].data[fn].id + '">' +
                '<i class="i ' + fns[c].data[fn].icon + '"></i>' +
                '<p>' + fns[c].data[fn].show + '</p>' +
                '</div>' +
                '</li>')
        }
        //注册点击事件
        $("#fn-" + fns[c].data[fn].id).click(function () {
            fns[c].data[fn].on()
        })
        //注册附带的功能
        fns[c].data[fn].reg()
    }
}
ipcRenderer.on('reload-page', function () {
    cur_webview.reload()
})
ipcRenderer.on('DEBUG', function (e, text) {
    console.log(text)
})

var cur_view = newTab(undefined, "active")
ipcRenderer.on('open-file', function (e, path, win, file_type) {
    if (win == "this") {
        // cur_webview.send("load-url", path);
        // cur_webview.loadURL(path);
        if (file_type === ".pdf") {
            cur_view.ToURL("howardbrowser://pdf-viewer?path=" + path)
        } else {
            cur_view.webview.loadURL(path);
        }
    } else {
        if (file_type === ".pdf") {
            newTab("howardbrowser://pdf-viewer?path=" + path, "active")
        } else {
            newTab(path, "active");
        }
    }
})

document.onreadystatechange = function () {
    if (document.readyState == "complete") {
    }
};
ipcRenderer.on('notice-msg', (event, title, content, icon) => {
    notice(title, content, icon);
})




// /**
//  * 初始化右键菜单
//  */
// function initMenu(){

//     const menu = new Menu();
//     const menu2 = new Menu();
//     menu.append(new MenuItem({label:'撤销', role: 'undo' }));
//     menu.append(new MenuItem({label:'重做', role: 'redo' }));
//     // menu.append(new MenuItem({ role: 'separator' }));
//     menu.append(new MenuItem({label:'剪切', role: 'cut' }));
//     menu.append(new MenuItem({label:'复制', role: 'copy' }));
//     menu.append(new MenuItem({label:'粘贴', role: 'paste' }));
//     // menu.append(new MenuItem({ role: 'pasteandmatchstyle' }));
//     menu.append(new MenuItem({label:'删除', role: 'delete' }));
//     menu.append(new MenuItem({ label:'全选', role: 'selectall' }));

//     menu2.append(new MenuItem({label:'复制', role: 'copy' }));
//     //点击dome
//     menu2.append(new MenuItem({label:'show', click() { 
//         //展示选中文本
//         let selectText = window.getSelection().toString();
//         alert(selectText); 
//     } }));
window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    console.log(e);
    // if(isEleEditable(e.target)){
    //     menu.popup(remote.getCurrentWindow());
    // }else{
    //     //判断有文本选中
    //     let selectText = window.getSelection().toString();
    //     if(!!selectText){
    //         menu2.popup(remote.getCurrentWindow());
    //     }
    // }

}, false)
// }
// /**
//  * 判断点击区域可编辑
//  */
// function isEleEditable(e){
//     if(!e){
//         return false;
//     }
//     //为input标签或者contenteditable属性为true
//     if(e.tagName == 'INPUT' || e.contentEditable == 'true'){
//         return true;
//     }else{
//         //递归查询父节点
//         return isEleEditable(e.parentNode)
//     }
// }

// initMenu();