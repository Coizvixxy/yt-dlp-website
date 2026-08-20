const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // 添加靜態文件服務

// 創建下載文件夾（如果不存在）
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// 爲下載文件夾提供靜態文件服務
app.use('/downloads', express.static(downloadsDir));

// YouTube 登入 cookies 設定 —— 用來繞過「確認你不是機器人」(Sign in to confirm you're not a bot) 的 bot 偵測。
// 【自動載入】伺服器啟動時會自動讀項目資料夾入面嘅 cookies.txt（同 server.js 同一層）。
// 只需要做一次：用瀏覽器擴充功能 "Get cookies.txt LOCALLY" 匯出，將檔案改名做 cookies.txt
// 放喺呢個資料夾，以後開 server 唔使再 export 任何環境變數。
// （cookies.txt 等如你嘅 YouTube 登入憑證：唔好 commit 上 git、唔好分享俾人）
// 進階覆寫：COOKIES_FILE 環境變數可指定其他路徑；COOKIES_FROM_BROWSER 可改用瀏覽器 cookies。
const COOKIES_FILE = process.env.COOKIES_FILE || path.join(__dirname, 'cookies.txt');
const COOKIES_FROM_BROWSER = process.env.COOKIES_FROM_BROWSER ?? 'chrome'; // cookies.txt 唔存在時先會用到

// 畫質設定 ——
// true（預設）：優先 H.264（avc）+ mp4 —— 任何播放器、iPhone、電視都播到，
//              但 YouTube 嘅 H.264 最高只去到 1080p，有 4K 嘅片都只會攞 1080p。
// false：唔理 codec，攞條片嘅最高畫質（4K/8K 通常係 VP9 或 AV1）+ 最佳音頻，容器改用 mkv。
//        畫質最高，但 QuickTime/iPhone 原生播放器好可能播唔到（VLC、IINA、mpv 就冇問題）。
const PREFER_H264 = true;

// 偵測此環境的 yt-dlp 是否支援 --remote-components（2025.11.12+ 纔有）。
// 舊版不認得此選項，硬傳會令 yt-dlp 立即報「no such option」退出，故啟動時檢查一次。
let supportsRemoteComponents = false;
try {
    const ytdlpVersion = execFileSync('yt-dlp', ['--version'], { encoding: 'utf8' }).trim();
    console.log(`[啟動] yt-dlp 版本：${ytdlpVersion}`);
    supportsRemoteComponents = execFileSync('yt-dlp', ['--help'], { encoding: 'utf8' })
        .includes('--remote-components');
} catch (err) {
    console.warn('[警告] 無法執行 yt-dlp（--version / --help），假設不支援 --remote-components：', err.message);
}
if (!supportsRemoteComponents) {
    console.warn('[警告] 此環境的 yt-dlp 太舊，不支援 --remote-components（需 2025.11.12+）。' +
        '請更新：yt-dlp -U 或 pip install -U "yt-dlp[default]"，' +
        '否則 yt-dlp 不會收到 EJS 求解參數，YouTube 下載很大機會被簽章挑戰擋下。');
}

// 啟動時報告 cookies 來源，確認自動載入有冇生效
if (fs.existsSync(COOKIES_FILE)) {
    console.log(`[啟動] 已自動載入 cookies 檔案：${COOKIES_FILE}`);
} else {
    console.warn(`[啟動] 搵唔到 ${path.basename(COOKIES_FILE)}，將會嘗試瀏覽器 cookies` +
        `（${COOKIES_FROM_BROWSER || '已停用'}）——喺伺服器上通常會失敗，建議放一個 cookies.txt 喺項目資料夾。`);
}

// 添加文件清理設置
const FILE_CLEANUP = {
    enabled: true,              // 是否啓用文件清理
    intervalHours: 24,          // 清理間隔（小時）
    maxAgeHours: 72,            // 文件最大保留時間（小時）
    minSpaceGB: 1,              // 最小保留磁盤空間（GB）
    excludePattern: null        // 排除的文件模式（正則表達式）
};

// 文件清理函數
function cleanupDownloads() {
    if (!FILE_CLEANUP.enabled) return;
    
    console.log(`[${new Date().toISOString()}] 開始清理下載目錄...`);
    
    // 當前時間
    const now = new Date().getTime();
    // 最大文件年齡（毫秒）
    const maxAge = FILE_CLEANUP.maxAgeHours * 60 * 60 * 1000;
    let filesRemoved = 0;
    let spaceFreed = 0;
    
    try {
        // 獲取下載目錄中的所有文件
        const files = fs.readdirSync(downloadsDir);
        
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            
            // 跳過目錄
            if (fs.statSync(filePath).isDirectory()) return;
            
            // 檢查排除模式
            if (FILE_CLEANUP.excludePattern && FILE_CLEANUP.excludePattern.test(file)) {
                console.log(`[清理] 排除文件: ${file}`);
                return;
            }
            
            // 獲取文件狀態
            const stats = fs.statSync(filePath);
            const fileAge = now - stats.mtimeMs;
            
            // 檢查文件年齡
            if (fileAge > maxAge) {
                const fileSizeMB = stats.size / (1024 * 1024);
                console.log(`[清理] 刪除過期文件: ${file} (${fileSizeMB.toFixed(2)}MB, 年齡: ${(fileAge/(1000*60*60)).toFixed(1)}小時)`);
                
                try {
                    fs.unlinkSync(filePath);
                    filesRemoved++;
                    spaceFreed += stats.size;
                } catch (err) {
                    console.error(`[清理] 刪除文件失敗: ${file}`, err);
                }
            }
        });
        
        const spaceFreedMB = spaceFreed / (1024 * 1024);
        console.log(`[清理] 完成: 刪除了${filesRemoved}個文件, 釋放了${spaceFreedMB.toFixed(2)}MB空間`);
    } catch (err) {
        console.error('[清理] 錯誤:', err);
    }
}

// 獲取磁盤空間信息（僅限 Linux/Mac）
function checkDiskSpace() {
    return new Promise((resolve, reject) => {
        // 使用df命令獲取磁盤空間信息
        const df = spawn('df', ['-h', downloadsDir]);
        let output = '';
        
        df.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        df.stderr.on('data', (data) => {
            console.error(`df error: ${data}`);
        });
        
        df.on('close', (code) => {
            if (code !== 0) {
                console.warn(`df process exited with code ${code}`);
                resolve(null); // 無法獲取空間信息
                return;
            }
            
            try {
                // 解析輸出
                const lines = output.trim().split('\n');
                if (lines.length < 2) {
                    resolve(null);
                    return;
                }
                
                const parts = lines[1].split(/\s+/);
                // df輸出格式: Filesystem Size Used Avail Use% Mounted on
                const available = parts[3];
                let availableGB = 0;
                
                if (available.endsWith('G')) {
                    availableGB = parseFloat(available.slice(0, -1));
                } else if (available.endsWith('T')) {
                    availableGB = parseFloat(available.slice(0, -1)) * 1024;
                } else if (available.endsWith('M')) {
                    availableGB = parseFloat(available.slice(0, -1)) / 1024;
                }
                
                resolve({ availableGB });
            } catch (err) {
                console.error('Error parsing df output:', err);
                resolve(null);
            }
        });
    });
}

// 緊急清理（當磁盤空間不足時）
async function emergencyCleanup() {
    // 檢查是否是Windows（不支持df命令）
    if (process.platform === 'win32') {
        console.log('[清理] Windows系統跳過磁盤空間檢查');
        return;
    }
    
    try {
        const space = await checkDiskSpace();
        if (!space) return;
        
        if (space.availableGB < FILE_CLEANUP.minSpaceGB) {
            console.warn(`[清理] 磁盤空間不足! 可用: ${space.availableGB.toFixed(2)}GB, 最小要求: ${FILE_CLEANUP.minSpaceGB}GB`);
            
            // 獲取所有文件並按修改時間排序
            const files = fs.readdirSync(downloadsDir)
                .map(file => {
                    const filePath = path.join(downloadsDir, file);
                    const stats = fs.statSync(filePath);
                    return { name: file, path: filePath, mtime: stats.mtime, size: stats.size };
                })
                .filter(file => !fs.statSync(file.path).isDirectory()) // 排除目錄
                .sort((a, b) => a.mtime - b.mtime); // 按修改時間從舊到新排序
            
            let freedSpace = 0;
            let filesRemoved = 0;
            
            // 刪除舊文件直到釋放足夠空間
            for (const file of files) {
                if (space.availableGB + (freedSpace / (1024 * 1024 * 1024)) >= FILE_CLEANUP.minSpaceGB) {
                    break;
                }
                
                try {
                    fs.unlinkSync(file.path);
                    freedSpace += file.size;
                    filesRemoved++;
                    console.log(`[緊急清理] 刪除文件: ${file.name} (${(file.size/(1024*1024)).toFixed(2)}MB)`);
                } catch (err) {
                    console.error(`[緊急清理] 刪除文件失敗: ${file.name}`, err);
                }
            }
            
            console.log(`[緊急清理] 完成: 刪除了${filesRemoved}個文件, 釋放了${(freedSpace/(1024*1024)).toFixed(2)}MB空間`);
        }
    } catch (err) {
        console.error('[緊急清理] 錯誤:', err);
    }
}

// 設置定時清理
const cleanupIntervalMs = FILE_CLEANUP.intervalHours * 60 * 60 * 1000; // 轉換爲毫秒
setInterval(async () => {
    await emergencyCleanup(); // 首先檢查是否需要緊急清理
    cleanupDownloads();       // 然後執行常規清理
}, cleanupIntervalMs);

// 服務器啓動時也執行一次清理
setTimeout(async () => {
    await emergencyCleanup();
    cleanupDownloads();
}, 5000); // 延遲5秒後執行，確保服務器已完全啓動

app.post('/execute', (req, res) => {
    const { command, format = 'mp4' } = req.body; // 添加格式參數，默認爲mp4
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Accel-Buffering', 'no'); // 防止 nginx 等反向代理緩衝
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // 立即發送 headers，避免代理緩衝

    // 解析命令並添加優化參數
    const args = command.split(' ')
        .filter(arg => arg && arg !== '\\')
        .map(arg => {
            // 移除引號
            return arg.replace(/^["']|["']$/g, '');
        });

    // 找出所有 YouTube 連結
    const youtubeLinks = args.filter(arg => arg.includes('youtu'));
    let currentLinkIndex = 0;
    let downloadedFiles = [];

    // 記錄下載前的檔案列表，完成後用 filesystem 對比
    const filesBefore = new Set(fs.readdirSync(downloadsDir));

    // 執行命令時使用數組參數而非字符串，避免shell解析問題
    let executable = 'yt-dlp';
    let execArgs = [];
    
    if (format === 'mp3') {
        // MP3 格式的參數 (使用數組避免特殊字符問題)
        // 注意：唔好用 aria2c —— googlevideo CDN 會拒絕佢嘅多連接請求（HTTP 403），
        // yt-dlp 原生下載器先至識得帶正確 headers 同 YouTube CDN 溝通。
        execArgs = [
            '-f', 'bestaudio',
            '-x', '--audio-format', 'mp3',
            '--audio-quality', '0',
            '--no-check-certificate',  // 跳過SSL證書驗證
            '--progress',
            '--newline',
            '--no-part',  // 防止部分下載文件
            '--output-na-placeholder', '',  // 避免未知值替換問題
            '-o', path.join(downloadsDir, '%(title)s.%(ext)s')  // 簡化輸出格式
        ];
    } else {
        // MP4 格式的參數 - 畫質策略由上方 PREFER_H264 控制
        execArgs = [
            '-f', PREFER_H264
                ? 'bv*[vcodec^=avc]+ba/b[vcodec^=avc]/bv+ba/b'  // 最佳 H.264（上限 1080p）+ 最佳音頻
                : 'bv*+ba/b',                                     // 條片最高畫質（4K/8K 係 VP9/AV1）
            '--merge-output-format', PREFER_H264 ? 'mp4' : 'mkv',
            '--no-check-certificate',
            '--progress',
            '--newline',
            '-o', path.join(downloadsDir, '%(title)s.%(ext)s')
        ];
    }

    // 注入 cookies 以繞過 YouTube 的「確認你不是機器人」bot 偵測：
    // 優先用 COOKIES_FILE（伺服器部署用 cookies.txt），否則用本機瀏覽器 cookies。
    if (COOKIES_FILE && fs.existsSync(COOKIES_FILE)) {
        execArgs.push('--cookies', COOKIES_FILE);
    } else if (COOKIES_FROM_BROWSER) {
        execArgs.push('--cookies-from-browser', COOKIES_FROM_BROWSER);
    }

    // 啟用 EJS 遠端挑戰求解元件：新版 yt-dlp 必須靠它解 YouTube 的 n-challenge（簽章/限流），
    // 否則只抓得到 storyboard 圖片、拿不到影音格式。首次會從 GitHub 下載求解腳本並快取。
    // 舊版 yt-dlp（< 2025.11.12）不支援此選項，啟動時已偵測，避免直接報錯。
    if (supportsRemoteComponents) {
        execArgs.push('--remote-components', 'ejs:github');
    }

    // 添加YouTube鏈接
    if (youtubeLinks.length > 0) {
        execArgs.push(youtubeLinks[currentLinkIndex]);
    }

    // 使用spawn執行命令，不使用shell選項
    const ytdlp = spawn(executable, execArgs, { 
        env: {
            ...process.env,
            PYTHONUNBUFFERED: '1'
        }
    });

    // 處理輸出並捕獲文件名
    ytdlp.stdout.on('data', (data) => {
        const output = data.toString();
        
        try {
            // 解析進度
            const progressMatch = output.match(/(\d+\.?\d*)%/);
            
            // 更精確的文件名匹配，避免重複捕獲
            let fileName = null;
            
            // 合併格式時的消息
            const mergerMatch = output.match(/\[Merger\] Merging formats into "(.+?)"/);
            if (mergerMatch) {
                fileName = path.basename(mergerMatch[1].trim());
            }
            // 提取音頻時的消息
            else if (!fileName) {
                const extractMatch = output.match(/\[ExtractAudio\] Destination: (.+)/);
                if (extractMatch) {
                    fileName = path.basename(extractMatch[1].trim());
                }
            }
            // 已下載文件的消息
            else if (!fileName) {
                const alreadyDownloadedMatch = output.match(/\[download\] (.+?) has already been downloaded/);
                if (alreadyDownloadedMatch) {
                    fileName = path.basename(alreadyDownloadedMatch[1].trim());
                }
            }
            // 下載目標的消息
            else if (!fileName) {
                const destinationMatch = output.match(/\[download\] Destination: (.+)/);
                if (destinationMatch) {
                    fileName = path.basename(destinationMatch[1].trim());
                }
            }
            
            // 只有匹配到了文件名且是完整的MP3/MP4文件才添加
            if (fileName && (fileName.endsWith('.mp4') || fileName.endsWith('.mp3')) && 
                !fileName.includes('.temp') && !fileName.includes('.part') && 
                !downloadedFiles.includes(fileName)) {
                
                downloadedFiles.push(fileName);
                console.log('Added file to download list:', fileName);
            }
            
            const response = {
                progress: progressMatch ? parseFloat(progressMatch[1]) : null,
                status: output.trim(),
                currentVideo: currentLinkIndex + 1,
                totalVideos: youtubeLinks.length
            };
            
            res.write(JSON.stringify(response) + '\n');
        } catch (error) {
            console.error('Error processing output:', error);
        }
    });

    ytdlp.stderr.on('data', (data) => {
        try {
            const errText = data.toString().trim();
            // 同步輸出埋落 server console，方便 SSH 排查（唔使淨係靠網頁睇）
            console.error('[yt-dlp]', errText);
            const response = {
                status: `錯誤: ${errText}`
            };
            res.write(JSON.stringify(response) + '\n');
        } catch (error) {
            console.error('Error processing error output:', error);
        }
    });

    // 當一個視頻下載完成時
    ytdlp.on('close', (code) => {
        currentLinkIndex++;

        // exit code 非 0 = 此視頻下載失敗，記錄落 server log 方便排查
        if (code !== 0) {
            console.error(`[下載失敗] 第 ${currentLinkIndex}/${youtubeLinks.length} 個視頻，yt-dlp exit code: ${code}`);
        }
        
        if (currentLinkIndex < youtubeLinks.length) {
            // 開始下載下一個視頻
            // 複製之前的參數但替換YouTube鏈接
            const nextArgs = [...execArgs.slice(0, -1), youtubeLinks[currentLinkIndex]];
            
            const nextYtdlp = spawn(executable, nextArgs, {
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED: '1'
                }
            });

            // 重新綁定事件處理器
            nextYtdlp.stdout.on('data', ytdlp.stdout.listeners('data')[0]);
            nextYtdlp.stderr.on('data', ytdlp.stderr.listeners('data')[0]);
            nextYtdlp.on('close', ytdlp.listeners('close')[0]);
            nextYtdlp.on('error', ytdlp.listeners('error')[0]);
        } else {
            // 所有視頻都下載完成 — 掃描 filesystem 取得新檔案
            const filesAfter = fs.readdirSync(downloadsDir);
            const newFiles = filesAfter.filter(f => {
                if (filesBefore.has(f)) return false;
                const ext = path.extname(f).toLowerCase();
                return ext === '.mp4' || ext === '.mp3';
            });

            const finalFiles = newFiles.length > 0 ? newFiles : downloadedFiles;

            // 去重：清理 .f\d+. 後可能出現重複
            const uniqueUrls = [...new Set(finalFiles.map(file => {
                const cleanFileName = file.replace(/\.f\d+\./, '.');
                return `/downloads/${encodeURIComponent(cleanFileName)}`;
            }))];

            // 如實回報：冇產出檔案就係失敗，唔好再報「完成」誤導用戶
            if (uniqueUrls.length === 0) {
                res.write(JSON.stringify({
                    status: code === 0
                        ? '沒有新下載的檔案（可能已下載過）'
                        : '下載失敗：yt-dlp 出錯退出，請檢查上方的錯誤訊息',
                    error: true,
                    progress: 100,
                    currentVideo: youtubeLinks.length,
                    totalVideos: youtubeLinks.length,
                    downloadedFiles: []
                }) + '\n');
            } else {
                res.write(JSON.stringify({
                    status: '所有視頻下載完成',
                    progress: 100,
                    currentVideo: youtubeLinks.length,
                    totalVideos: youtubeLinks.length,
                    downloadedFiles: uniqueUrls
                }) + '\n');
            }
            res.end();
        }
    });

    // 錯誤處理
    ytdlp.on('error', (error) => {
        console.error('Process error:', error);
        try {
            res.write(JSON.stringify({
                status: `程序錯誤: ${error.message}`,
                error: true
            }) + '\n');
            res.end();
        } catch (e) {
            console.error('Error sending error message:', e);
            res.end();
        }
    });
});

// 修改下載路由以確保強制下載
app.get('/downloads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(downloadsDir, filename);
    
    // 檢查文件是否存在
    if (fs.existsSync(filePath)) {
        // 設置強制下載的頭信息
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        // 阻止緩存
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // 流式傳輸文件
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
    } else {
        // 文件不存在
        res.status(404).send('文件不存在');
    }
});

// 添加文件管理API
app.get('/files', (req, res) => {
    try {
        // 獲取下載目錄中的所有文件
        const files = fs.readdirSync(downloadsDir)
            .filter(file => {
                const filePath = path.join(downloadsDir, file);
                return fs.statSync(filePath).isFile();
            })
            .map(file => {
                const filePath = path.join(downloadsDir, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    size: stats.size,
                    mtime: stats.mtime
                };
            })
            .sort((a, b) => b.mtime - a.mtime); // 按修改時間從新到舊排序
        
        res.json(files);
    } catch (err) {
        console.error('Error getting file list:', err);
        res.status(500).json({ error: 'Failed to get file list' });
    }
});

// 刪除指定文件
app.delete('/files/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(downloadsDir, filename);
    
    try {
        // 檢查文件是否存在
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // 檢查是否爲文件
        if (!fs.statSync(filePath).isFile()) {
            return res.status(400).json({ error: 'Not a file' });
        }
        
        // 刪除文件
        fs.unlinkSync(filePath);
        console.log(`[手動刪除] 文件已刪除: ${filename}`);
        res.json({ success: true });
    } catch (err) {
        console.error(`Error deleting file ${filename}:`, err);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// 手動觸發清理
app.post('/cleanup', (req, res) => {
    try {
        // 當前時間
        const now = new Date().getTime();
        // 最大文件年齡（毫秒）
        const maxAge = FILE_CLEANUP.maxAgeHours * 60 * 60 * 1000;
        let filesRemoved = 0;
        let spaceFreed = 0;
        
        // 獲取下載目錄中的所有文件
        const files = fs.readdirSync(downloadsDir);
        
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            
            // 跳過目錄
            if (fs.statSync(filePath).isDirectory()) return;
            
            // 獲取文件狀態
            const stats = fs.statSync(filePath);
            const fileAge = now - stats.mtimeMs;
            
            // 檢查文件年齡
            if (fileAge > maxAge) {
                try {
                    fs.unlinkSync(filePath);
                    filesRemoved++;
                    spaceFreed += stats.size;
                    console.log(`[手動清理] 刪除文件: ${file}`);
                } catch (err) {
                    console.error(`[手動清理] 刪除文件失敗: ${file}`, err);
                }
            }
        });
        
        const spaceFreedMB = (spaceFreed / (1024 * 1024)).toFixed(2);
        console.log(`[手動清理] 完成: 刪除了${filesRemoved}個文件, 釋放了${spaceFreedMB}MB空間`);
        
        res.json({
            success: true,
            filesRemoved,
            spaceFreedMB
        });
    } catch (err) {
        console.error('[手動清理] 錯誤:', err);
        res.status(500).json({ error: 'Failed to cleanup files' });
    }
});

const PORT = 23124;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Website available at: http://localhost:${PORT}/ytcommand.html`);
    console.log(`Downloads will be saved to: ${downloadsDir}`);

    // 檢查 yt-dlp 命令是否可用
    const checkCommand = spawn('which', ['yt-dlp']);
    checkCommand.on('close', (code) => {
        if (code !== 0) {
            console.warn('警告: yt-dlp 命令似乎不可用。請確保它已正確安裝。');
        } else {
            console.log('yt-dlp 命令可用，可以開始下載。');
        }
    });
}); 
