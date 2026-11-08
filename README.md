# LiftLog 重訓紀錄器

記錄每一組重訓、追蹤 PR、進步曲線、1RM 計算與休息計時的手機 App（PWA）。

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

資料存在**手機上的 IndexedDB 資料庫**（瀏覽器內建的資料庫），每一組訓練都是一筆獨立紀錄：

| 資料表 | 內容 |
| --- | --- |
| `sets` | 每一組：日期、動作、重量、次數、RPE、備註（以 `date`、`exercise` 建索引） |
| `meta` | 自訂動作、設定 |

- 不需要另外架伺服器或資料庫，也不用登入。
- 舊版存在 localStorage 的資料，第一次開啟新版時會自動搬進資料庫。
- App 會向系統申請「持久保存」；從主畫面開啟的 App 不會被 Safari 的 7 天自動清除機制影響。
- **刪除 App 或清除 Safari 網站資料會一起清掉**，請定期在「統計 → 資料管理」匯出 JSON 備份（iPhone 上可直接存到「檔案」或 iCloud 雲碟）。超過 14 天沒備份會提醒。

需要**多裝置同步**（例如手機＋電腦同時看）時，才需要雲端資料庫（如 Supabase、Firebase），並加上登入功能。

## 功能

- 單組紀錄：部位 → 動作兩層選單、重量/次數加減鍵、**一次記錄多組**、**RPE 自覺強度**、備註
- 歷史紀錄（依日期分組、編輯/刪除、PR 標示）
- 進步曲線：估算 1RM／最大重量／訓練量
- 1RM 計算機（Epley、Brzycki）與強度對照表
- 休息計時器（音效提示、背景回來自動校正、**螢幕常亮選項**）
- 統計：訓練總覽、**連續訓練週數**、**16 週訓練月曆**、**本週各部位組數**、個人紀錄 PR
- 自訂動作、JSON 匯出/匯入
- 離線可用（Service Worker 快取，Chart.js 已放在 `vendor/`）

## 檔案結構

```
index.html              主程式
manifest.webmanifest    PWA 設定（名稱、圖示、全螢幕）
sw.js                   Service Worker（離線快取）
icons/                  App 圖示
vendor/chart.umd.min.js Chart.js 4.4.1（MIT）
```

更新程式後，請把 `sw.js` 裡的 `VERSION` 加 1，手機才會抓到新版。
