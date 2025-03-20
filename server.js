const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // 添加靜態文件服務

// 创建下载文件夹（如果不存在）
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// 为下载文件夹提供静态文件服务
app.use('/downloads', express.static(downloadsDir));

// 添加文件清理设置
const FILE_CLEANUP = {
    enabled: true,              // 是否启用文件清理
    intervalHours: 24,          // 清理间隔（小时）
    maxAgeHours: 72,            // 文件最大保留时间（小时）
    minSpaceGB: 1,              // 最小保留磁盘空间（GB）
    excludePattern: null        // 排除的文件模式（正则表达式）
};

// 文件清理函数
function cleanupDownloads() {
    if (!FILE_CLEANUP.enabled) return;
    
    console.log(`[${new Date().toISOString()}] 开始清理下载目录...`);
    
    // 当前时间
    const now = new Date().getTime();
    // 最大文件年龄（毫秒）
    const maxAge = FILE_CLEANUP.maxAgeHours * 60 * 60 * 1000;
    let filesRemoved = 0;
    let spaceFreed = 0;
    
    try {
        // 获取下载目录中的所有文件
        const files = fs.readdirSync(downloadsDir);
        
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            
            // 跳过目录
            if (fs.statSync(filePath).isDirectory()) return;
            
            // 检查排除模式
            if (FILE_CLEANUP.excludePattern && FILE_CLEANUP.excludePattern.test(file)) {
                console.log(`[清理] 排除文件: ${file}`);
                return;
            }
            
            // 获取文件状态
            const stats = fs.statSync(filePath);
            const fileAge = now - stats.mtimeMs;
            
            // 检查文件年龄
            if (fileAge > maxAge) {
                const fileSizeMB = stats.size / (1024 * 1024);
                console.log(`[清理] 删除过期文件: ${file} (${fileSizeMB.toFixed(2)}MB, 年龄: ${(fileAge/(1000*60*60)).toFixed(1)}小时)`);
                
                try {
                    fs.unlinkSync(filePath);
                    filesRemoved++;
                    spaceFreed += stats.size;
                } catch (err) {
                    console.error(`[清理] 删除文件失败: ${file}`, err);
                }
            }
        });
        
        const spaceFreedMB = spaceFreed / (1024 * 1024);
        console.log(`[清理] 完成: 删除了${filesRemoved}个文件, 释放了${spaceFreedMB.toFixed(2)}MB空间`);
    } catch (err) {
        console.error('[清理] 错误:', err);
    }
}

// 获取磁盘空间信息（仅限 Linux/Mac）
function checkDiskSpace() {
    return new Promise((resolve, reject) => {
        // 使用df命令获取磁盘空间信息
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
                resolve(null); // 无法获取空间信息
                return;
            }
            
            try {
                // 解析输出
                const lines = output.trim().split('\n');
                if (lines.length < 2) {
                    resolve(null);
                    return;
                }
                
                const parts = lines[1].split(/\s+/);
                // df输出格式: Filesystem Size Used Avail Use% Mounted on
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

// 紧急清理（当磁盘空间不足时）
async function emergencyCleanup() {
    // 检查是否是Windows（不支持df命令）
    if (process.platform === 'win32') {
        console.log('[清理] Windows系统跳过磁盘空间检查');
        return;
    }
    
    try {
        const space = await checkDiskSpace();
        if (!space) return;
        
        if (space.availableGB < FILE_CLEANUP.minSpaceGB) {
            console.warn(`[清理] 磁盘空间不足! 可用: ${space.availableGB.toFixed(2)}GB, 最小要求: ${FILE_CLEANUP.minSpaceGB}GB`);
            
            // 获取所有文件并按修改时间排序
            const files = fs.readdirSync(downloadsDir)
                .map(file => {
                    const filePath = path.join(downloadsDir, file);
                    const stats = fs.statSync(filePath);
                    return { name: file, path: filePath, mtime: stats.mtime, size: stats.size };
                })
                .filter(file => !fs.statSync(file.path).isDirectory()) // 排除目录
                .sort((a, b) => a.mtime - b.mtime); // 按修改时间从旧到新排序
            
            let freedSpace = 0;
            let filesRemoved = 0;
            
            // 删除旧文件直到释放足够空间
            for (const file of files) {
                if (space.availableGB + (freedSpace / (1024 * 1024 * 1024)) >= FILE_CLEANUP.minSpaceGB) {
                    break;
                }
                
                try {
                    fs.unlinkSync(file.path);
                    freedSpace += file.size;
                    filesRemoved++;
                    console.log(`[紧急清理] 删除文件: ${file.name} (${(file.size/(1024*1024)).toFixed(2)}MB)`);
                } catch (err) {
                    console.error(`[紧急清理] 删除文件失败: ${file.name}`, err);
                }
            }
            
            console.log(`[紧急清理] 完成: 删除了${filesRemoved}个文件, 释放了${(freedSpace/(1024*1024)).toFixed(2)}MB空间`);
        }
    } catch (err) {
        console.error('[紧急清理] 错误:', err);
    }
}

// 设置定时清理
const cleanupIntervalMs = FILE_CLEANUP.intervalHours * 60 * 60 * 1000; // 转换为毫秒
setInterval(async () => {
    await emergencyCleanup(); // 首先检查是否需要紧急清理
    cleanupDownloads();       // 然后执行常规清理
}, cleanupIntervalMs);

// 服务器启动时也执行一次清理
setTimeout(async () => {
    await emergencyCleanup();
    cleanupDownloads();
}, 5000); // 延迟5秒后执行，确保服务器已完全启动

app.post('/execute', (req, res) => {
    const { command, format = 'mp4' } = req.body; // 添加格式参数，默认为mp4
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

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

    // 執行命令時使用數組參數而非字符串，避免shell解析問題
    let executable = 'yt-dlp';
    let execArgs = [];
    
    if (format === 'mp3') {
        // MP3 格式的参数 (使用數組避免特殊字符問題)
        execArgs = [
            '-f', 'bestaudio',
            '-x', '--audio-format', 'mp3',
            '--audio-quality', '0',
            '--progress',
            '--newline',
            '--no-part',  // 防止部分下载文件
            '--downloader', 'aria2c',
            '--downloader-args', 'aria2c:--max-concurrent-downloads=4 --max-connection-per-server=4 --min-split-size=1M',
            '--output-na-placeholder', '',  // 避免未知值替换问题
            '-o', path.join(downloadsDir, '%(title)s.%(ext)s')  // 简化输出格式
        ];
    } else {
        // MP4 格式的参数 (使用數組避免特殊字符問題)
        execArgs = [
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',  // 修改格式选择
            '--merge-output-format', 'mp4',
            '--concurrent-fragments', '4',
            '--buffer-size', '16K',
            '--progress',
            '--newline',
            '--no-part',  // 防止部分下载文件
            '--downloader', 'aria2c',
            '--downloader-args', 'aria2c:--max-concurrent-downloads=4 --max-connection-per-server=4 --min-split-size=1M',
            '--output-na-placeholder', '',  // 避免未知值替换问题
            '-o', path.join(downloadsDir, '%(title)s.%(ext)s')  // 简化输出格式
        ];
    }
    
    // 添加YouTube链接
    if (youtubeLinks.length > 0) {
        execArgs.push(youtubeLinks[currentLinkIndex]);
    }

    // 使用spawn执行命令，不使用shell选项
    const ytdlp = spawn(executable, execArgs, { 
        env: {
            ...process.env,
            PYTHONUNBUFFERED: '1'
        }
    });

    // 处理输出并捕获文件名
    ytdlp.stdout.on('data', (data) => {
        const output = data.toString();
        
        try {
            // 解析进度
            const progressMatch = output.match(/(\d+\.?\d*)%/);
            
            // 更精确的文件名匹配，避免重复捕获
            let fileName = null;
            
            // 合并格式时的消息
            const mergerMatch = output.match(/\[Merger\] Merging formats into "(.+?)"/);
            if (mergerMatch) {
                fileName = path.basename(mergerMatch[1].trim());
            }
            // 提取音频时的消息
            else if (!fileName) {
                const extractMatch = output.match(/\[ExtractAudio\] Destination: (.+)/);
                if (extractMatch) {
                    fileName = path.basename(extractMatch[1].trim());
                }
            }
            // 已下载文件的消息
            else if (!fileName) {
                const alreadyDownloadedMatch = output.match(/\[download\] (.+?) has already been downloaded/);
                if (alreadyDownloadedMatch) {
                    fileName = path.basename(alreadyDownloadedMatch[1].trim());
                }
            }
            // 下载目标的消息
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
            const response = {
                status: `錯誤: ${data.toString().trim()}`
            };
            res.write(JSON.stringify(response) + '\n');
        } catch (error) {
            console.error('Error processing error output:', error);
        }
    });

    // 當一個視頻下載完成時
    ytdlp.on('close', (code) => {
        currentLinkIndex++;
        
        if (currentLinkIndex < youtubeLinks.length) {
            // 開始下載下一個視頻
            // 复制之前的参数但替换YouTube链接
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
            // 所有視頻都下載完成
            res.write(JSON.stringify({
                status: '所有視頻下載完成',
                progress: 100,
                currentVideo: youtubeLinks.length,
                totalVideos: youtubeLinks.length,
                downloadedFiles: downloadedFiles.map(file => {
                    // 确保返回完整的URL路径，不带有格式标识符
                    const cleanFileName = file.replace(/\.f\d+\./, '.');
                    return `/downloads/${cleanFileName}`;
                })
            }) + '\n');
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

// 修改下载路由以确保强制下载
app.get('/downloads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(downloadsDir, filename);
    
    // 检查文件是否存在
    if (fs.existsSync(filePath)) {
        // 设置强制下载的头信息
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        // 阻止缓存
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        // 流式传输文件
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
        // 获取下载目录中的所有文件
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
            .sort((a, b) => b.mtime - a.mtime); // 按修改时间从新到旧排序
        
        res.json(files);
    } catch (err) {
        console.error('Error getting file list:', err);
        res.status(500).json({ error: 'Failed to get file list' });
    }
});

// 删除指定文件
app.delete('/files/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(downloadsDir, filename);
    
    try {
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // 检查是否为文件
        if (!fs.statSync(filePath).isFile()) {
            return res.status(400).json({ error: 'Not a file' });
        }
        
        // 删除文件
        fs.unlinkSync(filePath);
        console.log(`[手动删除] 文件已删除: ${filename}`);
        res.json({ success: true });
    } catch (err) {
        console.error(`Error deleting file ${filename}:`, err);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// 手动触发清理
app.post('/cleanup', (req, res) => {
    try {
        // 当前时间
        const now = new Date().getTime();
        // 最大文件年龄（毫秒）
        const maxAge = FILE_CLEANUP.maxAgeHours * 60 * 60 * 1000;
        let filesRemoved = 0;
        let spaceFreed = 0;
        
        // 获取下载目录中的所有文件
        const files = fs.readdirSync(downloadsDir);
        
        files.forEach(file => {
            const filePath = path.join(downloadsDir, file);
            
            // 跳过目录
            if (fs.statSync(filePath).isDirectory()) return;
            
            // 获取文件状态
            const stats = fs.statSync(filePath);
            const fileAge = now - stats.mtimeMs;
            
            // 检查文件年龄
            if (fileAge > maxAge) {
                try {
                    fs.unlinkSync(filePath);
                    filesRemoved++;
                    spaceFreed += stats.size;
                    console.log(`[手动清理] 删除文件: ${file}`);
                } catch (err) {
                    console.error(`[手动清理] 删除文件失败: ${file}`, err);
                }
            }
        });
        
        const spaceFreedMB = (spaceFreed / (1024 * 1024)).toFixed(2);
        console.log(`[手动清理] 完成: 删除了${filesRemoved}个文件, 释放了${spaceFreedMB}MB空间`);
        
        res.json({
            success: true,
            filesRemoved,
            spaceFreedMB
        });
    } catch (err) {
        console.error('[手动清理] 错误:', err);
        res.status(500).json({ error: 'Failed to cleanup files' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Website available at: http://localhost:${PORT}/ytcommand.html`);
    console.log(`Downloads will be saved to: ${downloadsDir}`);

    // 检查 yt-dlp 命令是否可用
    const checkCommand = spawn('which', ['yt-dlp']);
    checkCommand.on('close', (code) => {
        if (code !== 0) {
            console.warn('警告: yt-dlp 命令似乎不可用。请确保它已正确安装。');
        } else {
            console.log('yt-dlp 命令可用，可以开始下载。');
        }
    });
}); 