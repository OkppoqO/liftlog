# LiftLog 重訓紀錄器

記錄每一組重訓、健身菜單、訓練日曆、進步曲線與休息計時的手機 App（PWA）。

## 在 iPhone 上安裝

1. 把這個 repo 部署到 GitHub Pages：
   GitHub repo → **Settings → Pages** → Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/ (root)` → Save。
   約 1 分鐘後網址會是 `https://<你的帳號>.github.io/liftlog/`。
2. 用 iPhone 的 **Safari** 打開上面的網址。
3. 點「分享」按鈕 → **加入主畫面**。
4. 之後從主畫面圖示開啟，會以全螢幕 App 的形式執行，**沒網路也能用**。

> 不需要 Mac、Xcode 或 Apple 開發者帳號（每年 US$99）。
> 若未來想上架 App Store，可用 [Capacitor](https://capacitorjs.com/) 把同一份程式包成原生 App。

## 資料存在哪裡？

資料存在**手機上的 IndexedDB 資料庫**（瀏覽器內建的資料庫），不需要另外架伺服器：

| 資料表 | 內容 |
| --- | --- |
| `sets` | 每一組：日期、動作、重量、次數、RPE、備註（以 `date`、`exercise` 建索引） |
| `meta` | 自訂動作、健身菜單、設定 |

- 自訂動作與菜單會永久保存；「清除訓練紀錄」只清紀錄，不會刪掉它們；匯入備份時會合併。
- 舊版的資料與舊動作名稱（例如「啞鈴彎舉」→「啞鈴二頭彎舉」）會自動轉換。
- **刪除 App 或清除 Safari 網站資料會一起清掉**，請定期在 ⚙︎ →「資料備份」匯出（iPhone 可直接存到「檔案」或 iCloud 雲碟）。

需要**多裝置同步**時，才需要雲端資料庫（如 Supabase、Firebase）與登入功能。

## 功能

- **訓練**：選動作 → 自動帶入「這個動作」上次的重量與次數 → 記錄。同一天同一動作的多組會合併成一列。
- **動作庫**：306 個內建動作，依「部位（胸肩背腿核心二頭三頭）→ 器材（槓鈴／啞鈴／繩索／器械／自重）」分類，可搜尋中英文；每個動作都有起始／結束示範圖（交替播放成動態示範），並可一鍵開啟 YouTube 教學影片。
- **自重動作**（引體向上、懸吊抬腿…）：重量欄變成「額外負重」，可留空＝自重。
- **菜單**：自由組合動作與組數，訓練時選「今天練什麼」就列出整份菜單與完成進度，做完自動跳下一個動作。
- **日曆**：月曆標出有訓練的日子與練的部位，點日期看當天紀錄、可補記錄。
- **進度**：本週訓練天數／組數、連續訓練週數、各部位組數、進步曲線（自重動作看次數）、個人紀錄 PR。
- **休息計時器**：計時中鎖定螢幕，鎖定畫面會像音樂播放一樣顯示倒數；時間到播放響亮鈴聲（跟隨媒體音量，靜音模式也會響）。可選螢幕常亮。
- 離線可用（Service Worker 快取；示範圖看過一次後會快取）。

## 檔案結構

```
index.html              版面與樣式
app.js                  主程式
exercises.js            動作資料（由 tools/build_exercises.py 產生）
img/ex/                 動作示範圖
tools/build_exercises.py 產生動作資料與圖片的腳本
manifest.webmanifest    PWA 設定
sw.js                   Service Worker（離線快取）
icons/                  App 圖示
vendor/chart.umd.min.js Chart.js 4.4.1（MIT）
```

更新程式後，請把 `sw.js` 裡的 `VERSION` 加 1，手機才會抓到新版。

動作資料與示範圖來源：[free-exercise-db](https://github.com/yuhonas/free-exercise-db)（Unlicense 公有領域）。
