import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "search-plugin";
const extensionSettings = extension_settings[extensionName] || {};
const defaultSettings = {
    searchScope: "loaded", // "loaded" 或 "full"，默认只检索已加载消息
    realTimeRendering: true, // 默认开启实时渲染
    highlightKeywords: true // 默认开启关键词高亮
};

// 初始化插件设置
function initSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
}

// 获取聊天记录（支持全文检索）
async function fetchChatLog(chatId, start = 0, end) {
    try {
        const url = `/api/shells/chat/getchatlog?chatid=${chatId}&start=${start}${end ? `&end=${end}` : ''}`;
        const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
        if (!response.ok) {
            const message = `获取聊天记录失败: HTTP ${response.status} - ${response.statusText}`;
            console.error(message);
            throw new Error(message);
        }
        return await response.json();
    } catch (error) {
        console.error("fetchChatLog error:", error);
        toastr.error("获取聊天记录失败，请检查控制台日志");
        return null;
    }
}

// 获取聊天记录总长度
async function getChatLogLength(chatId) {
    try {
        const response = await fetch(`/api/shells/chat/getchatloglength?chatid=${chatId}`);
        if (!response.ok) {
            const message = `获取聊天记录长度失败: HTTP ${response.status} - ${response.statusText}`;
            console.error(message);
            throw new Error(message);
        }
        const data = await response.json();
        return data.length;
    } catch (error) {
        console.error("getChatLogLength error:", error);
        toastr.error("获取聊天记录长度失败，请检查控制台日志");
        return 0;
    }
}

// 滚动到指定消息
function scrollToMessage(messageId) {
    const messageElement = document.querySelector(`.mes[mesid="${messageId}"]`);
    if (messageElement) {
        messageElement.scrollIntoView({ behavior: "smooth", block: "start" }); // 滚动到消息顶部
    } else {
        toastr.error("无法跳转到指定楼层：消息未加载或不存在", null, { class: 'toast-error' });
    }
}

// 关键词检索
async function searchMessages(keyword) {
    if (!keyword) {
        resetHighlight(); // 清除高亮
        return;
    }
    const context = getContext();
    if (!context || !context.chat || !context.chatId) {
        console.warn("getContext() 或 chat 上下文不可用");
        toastr.error("聊天上下文不可用，请重试", null, { class: 'toast-error' });
        return;
    }
    const chat = context.chat;
    const settings = extension_settings[extensionName];
    let results = [];
    console.log(`开始关键词检索: 关键词="${keyword}", 检索范围="${settings.searchScope}", 实时渲染="${settings.realTimeRendering}", 关键词提亮="${settings.highlightKeywords}"`);

    if (settings.searchScope === "loaded") {
        console.log("检索范围：已加载消息");
        results = chat.filter(msg => msg.mes && msg.mes.toLowerCase().includes(keyword.toLowerCase())).map((msg, index) => ({
            id: index, // 使用 chat 数组的索引作为 messageId
            content: msg.mes
        }));
        console.log(`已加载消息检索结果数量: ${results.length}`);
        if (results.length > 0) {
            scrollToMessage(results[0].id);
            if (settings.highlightKeywords) highlightKeyword(keyword);
        } else {
            toastr.error("关键词检索失败：在已加载消息中未找到匹配消息", null, { class: 'toast-error' });
            resetHighlight(); // 清除高亮
        }
    } else if (settings.searchScope === "full") {
        console.log("检索范围：全文消息");
        const chatLength = await getChatLogLength(context.chatId);
        if (chatLength === 0) {
            toastr.error("关键词检索失败：聊天记录为空", null, { class: 'toast-error' });
            return;
        }
        const fullChat = await fetchChatLog(context.chatId, 0, chatLength);
        if (!fullChat) { // fetchChatLog 失败时返回 null
            return; // 错误信息已在 fetchChatLog 中提示
        }
        results = fullChat.filter(msg => msg.content && msg.content.toLowerCase().includes(keyword.toLowerCase())).map((msg, index) => ({
            id: index, // 使用 fullChat 的索引作为 messageId，这里假设 API 返回的消息顺序与楼层一致
            content: msg.content
        }));
        console.log(`全文消息检索结果数量: ${results.length}`);
        if (results.length > 0) {
            scrollToMessage(results[0].id);
            if (settings.highlightKeywords) highlightKeyword(keyword);
        } else {
            toastr.error("关键词检索失败：在所有消息中未找到匹配消息", null, { class: 'toast-error' });
            resetHighlight(); // 清除高亮
        }
    } else {
        console.warn("未知的检索范围设置:", settings.searchScope);
        toastr.error("插件设置错误：未知的检索范围", null, { class: 'toast-error' });
    }
    console.log("关键词检索完成");
}

// 高亮关键词
function highlightKeyword(keyword) {
    resetHighlight(); // 避免多次高亮叠加
    const messages = document.querySelectorAll(".mes_text");
    messages.forEach(msg => {
        const text = msg.innerHTML;
        const regex = new RegExp(`(${keyword})`, "gi");
        msg.innerHTML = text.replace(regex, '<span class="highlighted-keyword" style="color: red; font-weight: bold;">$1</span>');
    });
}

// 清除高亮
function resetHighlight() {
    const highlightedKeywords = document.querySelectorAll(".highlighted-keyword");
    highlightedKeywords.forEach(span => {
        const parent = span.parentNode;
        parent.innerHTML = parent.innerHTML.replace(span.outerHTML, span.textContent);
    });
}


// 楼层跳转
async function jumpToFloor(floorNumber) {
    const context = getContext();
    if (!context || !context.chat || !context.chatId) {
        console.warn("getContext() 或 chat 上下文不可用");
        toastr.error("聊天上下文不可用，请重试", null, { class: 'toast-error' });
        return;
    }
    const chat = context.chat;
    const floor = parseInt(floorNumber, 10);

    if (isNaN(floor) || floor < 0) {
        toastr.error("楼层号无效，请输入有效的数字", null, { class: 'toast-error' });
        return;
    }

    if (floor < chat.length) {
        scrollToMessage(floor); // 优先跳转已加载楼层
    } else {
        const chatLength = await getChatLogLength(context.chatId);
        if (floor < chatLength) {
            const fullChat = await fetchChatLog(context.chatId, floor, floor + 1); // 获取目标楼层附近的消息，预加载？实际上scrollToMessage已经处理了未加载的情况，这里fetchChatLog意义不大，可以优化
            if (fullChat) {
                 scrollToMessage(floor);
            }
        } else {
            toastr.error(`指定楼层跳转失败：楼层号超出范围 (当前消息总数: ${chatLength})`, null, { class: 'toast-error' });
        }
    }
}

// UI 初始化
jQuery(async () => {
    initSettings();

    const uiHtml = `
        <div id="search-plugin-ui">
            <div class="keyword-search">
                <input type="text" id="search-input" placeholder="输入关键词" />
                <button id="search-action" class="menu_button">${extensionSettings.realTimeRendering ? "清空" : "确定"}</button>
            </div>
            <div class="scroll-buttons">
                <button id="scroll-up" class="menu_button" title="滚动到最早消息">↑</button>
                <button id="jump-to-floor" class="menu_button">跳转楼层</button>
                <button id="scroll-down" class="menu_button" title="滚动到最新消息">↓</button>
            </div>
            <div class="advanced-settings-button-area">
                <button id="advanced-settings-btn" class="menu_button">高级检索设置</button>
            </div>

            <div id="advanced-settings-panel" class="hidden">
                <label for="search-scope-loaded">检索方式:</label>
                <input type="radio" id="search-scope-loaded" name="scope" value="loaded" ${extensionSettings.searchScope === "loaded" ? "checked" : ""}> <label for="search-scope-loaded">只检索加载消息</label>
                <input type="radio" id="search-scope-full" name="scope" value="full" ${extensionSettings.searchScope === "full" ? "checked" : ""}> <label for="search-scope-full">检索全文消息</label>
                <br>
                <label for="real-time-rendering">检索渲染:</label>
                <input type="checkbox" id="real-time-rendering" ${extensionSettings.realTimeRendering ? "checked" : ""}> <label for="real-time-rendering">实时渲染</label>
                <br>
                <label for="highlight-keywords">关键词提亮:</label>
                <input type="checkbox" id="highlight-keywords" ${extensionSettings.highlightKeywords ? "checked" : ""}> <label for="highlight-keywords">关键词提亮</label>
                <button id="save-settings" class="menu_button">保存设置</button>
            </div>
            <div id="floor-jump-popup" class="hidden">
                <label for="floor-input">跳转到指定楼层</label>
                <input type="number" id="floor-input" placeholder="输入楼层号" />
                <div id="floor-info"></div>
                <button id="floor-jump-action" class="menu_button">跳转</button>
            </div>
        </div>
    `;
    $("body").append(uiHtml);

    // 关键词检索
    $("#search-input").on("input", () => {
        if (extensionSettings.realTimeRendering) {
            searchMessages($("#search-input").val());
        }
    });
    $("#search-action").on("click", () => {
        if (extensionSettings.realTimeRendering) {
            $("#search-input").val("");
            resetHighlight(); // 清空关键词高亮
        } else {
            searchMessages($("#search-input").val());
        }
    });

    // 快速滚动
    $("#scroll-up").on("click", () => {
        const firstMessage = document.querySelector(".mes:first-child");
        if (firstMessage) {
            firstMessage.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
            toastr.error("无法滚动到最早消息：聊天记录为空或未加载", null, { class: 'toast-error' });
        }
    });
    $("#scroll-down").on("click", () =>  {
        const lastMessage = document.querySelector(".mes:last-child");
        if (lastMessage) {
            lastMessage.scrollIntoView({ behavior: "smooth", block: "end" });
        } else {
            toastr.error("无法滚动到最新消息：聊天记录为空或未加载", null, { class: 'toast-error' });
        }
    });


    // 楼层跳转
    $("#jump-to-floor").on("click", () => $("#floor-jump-popup").toggleClass("hidden"));
    $("#floor-input").on("input", () => {
        const floor = $("#floor-input").val();
        const context = getContext();
        if (!context || !context.chat) return; // 避免 context.chat 为 undefined
        const chat = context.chat;

        if (!isNaN(parseInt(floor, 10)) && parseInt(floor, 10) >= 0) { // 简单的数字验证
            if (floor < chat.length && chat[floor]) { // 检查索引是否有效，并避免chat[floor]为undefined
                 $("#floor-info").text(`楼层 ${floor}: ${chat[floor].mes}`);
            } else {
                getChatLogLength(context.chatId).then(length => {
                    if (floor < length) {
                        fetchChatLog(context.chatId, floor, floor + 1).then(msg => {
                             if (msg && msg[0]) { // 确保 msg 和 msg[0] 存在
                                $("#floor-info").text(`楼层 ${floor}: ${msg[0].content}`);
                            } else {
                                $("#floor-info").text("楼层信息加载失败");
                            }
                        });
                    } else {
                         $("#floor-info").text("楼层号超出范围");
                    }
                });
            }
        } else {
             $("#floor-info").text("请输入有效楼层号");
        }
    });
    $("#floor-info").on("click", () => {
        if ($("#floor-info").text().startsWith("楼层")) { // 简单判断是否显示了楼层信息才跳转
             jumpToFloor($("#floor-input").val());
             $("#floor-jump-popup").addClass("hidden"); // 跳转后隐藏弹窗
        }
    });
     $("#floor-jump-action").on("click", () => {
        jumpToFloor($("#floor-input").val());
        $("#floor-jump-popup").addClass("hidden"); // 跳转后隐藏弹窗
    });


    // 高级设置
    $("#advanced-settings-btn").on("click", () => $("#advanced-settings-panel").toggleClass("hidden"));
    $("input[name='scope']").on("change", (e) => extensionSettings.searchScope = e.target.value);
    $("#real-time-rendering").on("change", (e) => {
        extensionSettings.realTimeRendering = e.target.checked;
        $("#search-action").text(e.target.checked ? "清空" : "确定");
    });
    $("#highlight-keywords").on("change", (e) => extensionSettings.highlightKeywords = e.target.checked);
    $("#save-settings").on("click", () => {
        saveSettingsDebounced();
        $("#advanced-settings-panel").addClass("hidden");
        toastr.success("高级检索设置已保存", null, { timeOut: 1500 }); // 提示保存成功
    });
});