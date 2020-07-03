/*!
 * ckLine.js v1.0.8 (http://github.com/captainKeller/ckLine)
 * @copyright Jonas Nickel
 * @license GPL-3.0 (http://github.com/captainKeller/ckLine/blob/master/LICENSE)
 */
(function ($) {
    'use strict';
    $.fn.ckLine = function (options) {
        var viewportwidth = this.width(),
            viewportHeight = this.height(),
            $el = this.attr('id'),
            interval = null,
            settings = $.extend({
                svgId: null,
                strokeColor: "#000",
                strokeWidth: 2,
                animateTime: 1000,
                interval: 600,
                fadeOutTime: 800,
                lifeTime: 2000,
                width: viewportwidth,
                height: viewportHeight,
                leftRight: true,
                easing: 'swing',
                animationTimeRange: null
            }, options);
        $.fn.ckLine.destroy = function () {
            if (interval) {
                clearInterval(interval);
            }
        };
        function creatLine(width, height) {
            var startItemsWidth = new Array(0, width),
                ramdomItemWidth = startItemsWidth[Math.floor(Math.random() * startItemsWidth.length)],
                startItemsHeight = new Array(0, height),
                ramdomItemHeight = startItemsHeight[Math.floor(Math.random() * startItemsHeight.length)];
            var svgns = "http://www.w3.org/2000/svg";
            var x1 = ramdomItemWidth,
                y1 = Math.random() * height,
                x2,
                y2 = Math.random() * height;
            var randomBool = true;
            if (settings.leftRight === false) {
                randomBool = Math.random() >= 0.5;
            }
            if (randomBool == true) {
                x1 = ramdomItemWidth
                if (ramdomItemWidth === 0) {
                    x2 = width;
                } else {
                    x2 = 0;
                }
            } else {
                var range1 = Math.floor(Math.random() * width) + 0;
                var range2 = Math.floor(Math.random() * width) + 0;
                x1 = range1;
                x2 = range2;
                y1 = ramdomItemHeight;
                if (ramdomItemHeight === 0) {
                    y2 = height;
                } else {
                    y2 = 0;
                }
            }
            //var line = document.createElementNS(svgns, 'line');
            var line = document.createElementNS(svgns, 'path');
            line.setAttributeNS(null, 'd','M '+ x1+','+y1+' L '+x2+','+y2);
            line.setAttributeNS(null, 'stroke-width', settings.strokeWidth);
            line.setAttributeNS(null, 'stroke', settings.strokeColor);
            line.setAttributeNS(null, 'class', "line off")
            if (settings.svgId) {
                document.getElementById(settings.svgId).appendChild(line);
            } else {
                document.getElementById($el).appendChild(line);
            }
            var length = line.getTotalLength();
            line.setAttributeNS(null, 'stroke-dasharray', length);
            line.setAttributeNS(null, 'stroke-dashoffset', length);
        }
        function animate() {
            var time = settings.animationTime;
            if (settings.animationTimeRange) {
                time = Math.floor(Math.random() * (settings.animationTimeRange[1] - settings.animationTimeRange[0] + 1) + settings.animationTimeRange[0])
                //console.log(time);
            }
            jQuery('.line.off').each(function () {
                jQuery(this).addClass('on').removeClass('off');
                jQuery(this).animate({
                    'stroke-dashoffset': 0
                }, time, settings.easing);
                var $this = jQuery(this);
                setTimeout(function () {
                    $this.fadeOut(settings.fadeOutTime, function () {
                        jQuery(this).remove();
                    });
                }, settings.lifeTime)
            });
        }
        
        
        
        interval = setInterval(function () {
            creatLine(settings.width, settings.height);
            animate();
        }, settings.interval);
    };
}(jQuery));