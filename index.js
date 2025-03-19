import { extension_settings, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { callPopup } from "../../../../script.js";
import { getContext } from "../../../extensions.js";

// 插件名称和设置
const extensionName = "hide-helper";
const defaultSettings = {
    hideLastN: 0,
    advancedStart: -1,
    advancedEnd: -1,
    isAdvancedMode: false
};

// 初始化插件设置
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    
    // 更新UI以反映当前设置
    $("#hide-helper-last-n").val(extension_settings[extensionName].hideLastN);
    $("#hide-helper-advanced-start").val(extension_settings[extensionName].advancedStart);
    $("#hide-helper-advanced-end").val(extension_settings[extensionName].advancedEnd);
    
    // 如果是高级模式，显示高级设置面板
    if (extension_settings[extensionName].isAdvancedMode) {
        $(".hide-helper-advanced-panel").show();
    } else {
        $(".hide-helper-advanced-panel").hide();
    }
}

// 保存设置
function saveSettings() {
    saveSettingsDebounced();
}

// 应用隐藏设置
async function applyHideSettings() {
    const context = getContext();
    const chat = context.chat;
    
    if (!chat || chat.length === 0) {
        toastr.warning("聊天记录为空，无法应用隐藏设置");
        return;
    }
    
    // 先取消所有隐藏
    for (let i = 0; i < chat.length; i++) {
        if (chat[i].is_system) {
            await hideChatMessageRange(i, i, true);
        }
    }
    
    // 根据设置应用隐藏
    if (extension_settings[extensionName].isAdvancedMode) {
        // 高级模式：隐藏指定范围的消息
        const start = parseInt(extension_settings[extensionName].advancedStart);
        const end = parseInt(extension_settings[extensionName].advancedEnd);
        
        if (!isNaN(start) && !isNaN(end) && start >= -1 && end > start) {
            const actualStart = start === -1 ? 0 : start;
            const actualEnd = end >= chat.length ? chat.length - 1 : end;
            
            if (actualStart < actualEnd) {
                await hideChatMessageRange(actualStart, actualEnd, false);
                toastr.success(`已隐藏第 ${actualStart+1} 至 ${actualEnd+1} 条消息`);
            }
        }
    } else {
        // 基本模式：隐藏最后N条之前的所有消息
        const hideLastN = parseInt(extension_settings[extensionName].hideLastN);
        
        if (!isNaN(hideLastN) && hideLastN > 0 && hideLastN < chat.length) {
            const startIdx = 0;
            const endIdx = chat.length - hideLastN - 1;
            
            if (endIdx >= startIdx) {
                await hideChatMessageRange(startIdx, endIdx, false);
                toastr.success(`已隐藏第 ${startIdx+1} 至 ${endIdx+1} 条消息`);
            }
        }
    }
}

// 创建插件UI
function createUI() {
    const html = `
    <div class="hide-helper-panel">
        <div class="hide-helper-title">消息隐藏助手</div>
        
        <div class="hide-helper-section">
            <input type="number" id="hide-helper-last-n" class="hide-helper-input" placeholder="保留最后N条消息" min="0">
            <div class="hide-helper-buttons">
                <button id="hide-helper-advanced-btn" class="hide-helper-button">高级设置</button>
                <button id="hide-helper-apply-btn" class="hide-helper-button">应用</button>
            </div>
            
            <div class="hide-helper-advanced-panel" style="display: none;">
                <input type="number" id="hide-helper-advanced-start" class="hide-helper-advanced-input" placeholder="起始楼层" min="-1">
                <input type="number" id="hide-helper-advanced-end" class="hide-helper-advanced-input" placeholder="结束楼层">
                <button id="hide-helper-advanced-apply-btn" class="hide-helper-button">确定</button>
            </div>
        </div>
        
        <button id="hide-helper-save-btn" class="hide-helper-save-button">保存当前设置</button>
    </div>
    `;
    
    $("body").append(html);
    
    // 绑定事件
    $("#hide-helper-last-n").on("input", function() {
        extension_settings[extensionName].hideLastN = parseInt($(this).val()) || 0;
        extension_settings[extensionName].isAdvancedMode = false;
        $(".hide-helper-advanced-panel").hide();
        saveSettings();
    });
    
    $("#hide-helper-advanced-btn").on("click", function() {
        extension_settings[extensionName].isAdvancedMode = true;
        
        // 设置默认值
        const context = getContext();
        const chat = context.chat;
        
        if (!extension_settings[extensionName].advancedStart || extension_settings[extensionName].advancedStart < -1) {
            extension_settings[extensionName].advancedStart = -1;
            $("#hide-helper-advanced-start").val(-1);
        }
        
        if (!extension_settings[extensionName].advancedEnd || extension_settings[extensionName].advancedEnd <= extension_settings[extensionName].advancedStart) {
            extension_settings[extensionName].advancedEnd = chat ? chat.length : 0;
            $("#hide-helper-advanced-end").val(extension_settings[extensionName].advancedEnd);
        }
        
        $(".hide-helper-advanced-panel").show();
        saveSettings();
    });
    
    $("#hide-helper-apply-btn").on("click", function() {
        extension_settings[extensionName].isAdvancedMode = false;
        $(".hide-helper-advanced-panel").hide();
        applyHideSettings();
    });
    
    $("#hide-helper-advanced-start").on("input", function() {
        extension_settings[extensionName].advancedStart = parseInt($(this).val()) || -1;
        saveSettings();
    });
    
    $("#hide-helper-advanced-end").on("input", function() {
        extension_settings[extensionName].advancedEnd = parseInt($(this).val()) || 0;
        saveSettings();
    });
    
    $("#hide-helper-advanced-apply-btn").on("click", function() {
        applyHideSettings();
    });
    
    $("#hide-helper-save-btn").on("click", function() {
        applyHideSettings();
        saveSettings();
        toastr.success("设置已保存");
    });
}

// 导入hideChatMessageRange函数
async function hideChatMessageRange(start, end, unhide) {
    if (end === undefined || end === null) {
        end = start;
    }
    
    const hide = !unhide;
    const context = getContext();
    const chat = context.chat;
    
    if (!chat || chat.length === 0) {
        console.warn("Chat is empty, cannot hide messages");
        return;
    }
    
    // 确保start和end在有效范围内
    start = Math.max(0, Math.min(start, chat.length - 1));
    end = Math.max(0, Math.min(end, chat.length - 1));
    
    // 遍历指定范围的消息并设置is_system属性
    for (let messageId = start; messageId <= end; messageId++) {
        const message = chat[messageId];
        message.is_system = hide;
        
        // 更新DOM中的消息元素
        const messageBlock = $(`.mes[mesid="${messageId}"]`);
        messageBlock.attr('is_system', String(hide));
    }
    
    // 更新滑动按钮和保存聊天记录
    try {
        // 这些函数可能在全局作用域中
        if (typeof hideSwipeButtons === 'function') hideSwipeButtons();
        if (typeof showSwipeButtons === 'function') showSwipeButtons();
        if (typeof saveChatDebounced === 'function') saveChatDebounced();
    } catch (error) {
        console.error("Error updating UI after hiding messages:", error);
    }
}

// 监听新消息事件，自动应用隐藏设置
function setupMessageListener() {
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        // 如果设置了自动隐藏，则在收到新消息时应用隐藏设置
        if (extension_settings[extensionName].hideLastN > 0 || 
            (extension_settings[extensionName].isAdvancedMode && 
             extension_settings[extensionName].advancedStart >= -1 && 
             extension_settings[extensionName].advancedEnd > extension_settings[extensionName].advancedStart)) {
            applyHideSettings();
        }
    });
}

// 插件初始化
jQuery(async () => {
    // 加载设置
    loadSettings();
    
    // 创建UI
    createUI();
    
    // 设置消息监听器
    setupMessageListener();
    
    console.log("消息隐藏助手插件已加载");
});
