# YouTube 下載工具

一個簡單、高效的 YouTube 視頻下載網站，專為車載系統設計。

![image](https://github.com/Coizvixxy/yt-dlp-website/blob/main/screenshot1.png)

## 📖 簡介
這個項目旨在開發一個輕量級的網站，讓 YouTube 視頻的下載變得簡單又方便。它專門設計用於下載視頻到我的車載系統中播放，提供了友好的用戶界面和高效的下載功能。

## ✨ 主要功能
- 簡單的用戶界面：清晰直觀的設計，易於使用
- 多格式支持：支持下載 MP4 視頻和 MP3 音頻
- 批量下載：一次處理多個 YouTube 鏈接
- 高速下載：使用 aria2c 作為下載引擎，實現並發下載
- 文件管理：內置文件管理器，方便查看、下載和刪除文件
- 自動清理：定時清理舊文件，避免佔用過多磁盤空間

## 🔧 安裝

### 前置要求
- Node.js (v12.0.0 或更高版本)
- yt-dlp
- aria2c (用於並發下載)

### 安裝步驟
1. 安裝 yt-dlp 和 aria2c:
   ```bash
   # 對於 macOS (使用 Homebrew)
   brew install yt-dlp aria2
   ```
2. 克隆倉庫:
   ```bash
   git clone https://github.com/Coizvixxy/yt-dlp-website.git
   cd yt-dlp-website
   ```
3. 安裝依賴:
   ```bash
   npm install
   ```
4. 啟動服務器:
   ```bash
   node server.js
   ```
5. 在瀏覽器中訪問:
   ```
   http://localhost:3000/ytcommand.html
   ```

## 📱 使用方法
- 輸入 YouTube 鏈接：在文本框中粘貼一個或多個 YouTube 視頻鏈接，每行一個
- 選擇格式：選擇 MP3 或 MP4 格式
- 開始下載：點擊"開始下載"按鈕
- 查看進度：實時顯示下載進度和狀態
- 下載文件：下載完成後，點擊文件鏈接下載到本地設備
- 管理文件：使用文件管理器查看、下載或刪除服務器上的文件

## 📁 文件管理
軟件包含完整的文件管理功能:
- 文件列表：顯示所有下載的文件、大小和日期
- 下載文件：直接從服務器下載文件到本地設備
- 刪除文件：手動刪除不再需要的文件
- 自動清理：系統會自動清理超過 72 小時的舊文件
- 緊急清理：當磁盤空間不足時，系統會自動刪除最舊的文件

## 🛠️ 技術細節
- 前端：純 HTML, CSS 和 JavaScript
- 後端：Node.js 和 Express
- 下載引擎：yt-dlp 和 aria2c
- 數據存儲：本地文件系統

## ⚙️ 配置選項
可以在 `server.js` 中調整以下配置選項:
```javascript
const FILE_CLEANUP = {
    enabled: true,              // 是否啟用文件清理
    intervalHours: 24,          // 清理間隔（小時）
    maxAgeHours: 72,            // 文件最大保留時間（小時）
    minSpaceGB: 1,              // 最小保留磁盤空間（GB）
    excludePattern: null        // 排除的文件模式（正則表達式）
};
```

## 🚗 車載系統使用
這個工具特別適合車載系統使用:
1. 在家中或有 WiFi 的地方下載視頻/音頻
2. 將文件傳輸到車載系統的 USB 或 SD 卡
3. 在車內離線享受您喜愛的內容

## ⚠️ 免責聲明
此工具僅供個人使用，請尊重 YouTube 的服務條款和版權法。請勿分發受版權保護的內容。

## 📝 許可證
MIT License

--- 

注意: 請確保您使用此工具時符合您所在地區的法律法規和 YouTube 的服務條款。
