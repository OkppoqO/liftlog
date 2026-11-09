"""產生 exercises.js 與 img/ex/ 示範圖。

資料來源：free-exercise-db（https://github.com/yuhonas/free-exercise-db，Unlicense 公有領域）
用法：python3 tools/build_exercises.py <動作清單.txt> <free-exercise-db exercises.json>
"""
import io, json, os, re, sys, time, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
LEVEL = {'初階': 1, '中階': 2, '進階': 3}

# ---------- 1. 使用者提供的 205 個動作（胸肩背核心二頭三頭 × 啞鈴繩索器械） ----------
def parse_list(path):
    out, part, equip = [], None, None
    lines = open(path, encoding='utf-8').read().splitlines()
    for i, ln in enumerate(lines):
        m = re.match(r'^— (.+?)／(.+?)（\d+）—', ln)
        if m:
            part, equip = m.group(1), m.group(2); continue
        m = re.match(r'^\s*\d+\.\s+(.+)（([^（）]+)）— .+，(初階|中階|進階)$', ln)
        if m:
            url = lines[i + 1].strip()
            ex_id = re.search(r'/exercises/(.+?)/0\.jpg', url).group(1)
            out.append(dict(name=m.group(1), en=m.group(2), part=part, equip=equip, level=LEVEL[m.group(3)], img=ex_id))
    return out

# ---------- 2. 補充：槓鈴、自重、腿部 ----------
# (id, 中文名, 部位, 器材)
EXTRA = [
    # 胸
    ('Barbell_Bench_Press_-_Medium_Grip', '槓鈴臥推', '胸', '槓鈴'),
    ('Barbell_Incline_Bench_Press_-_Medium_Grip', '上斜槓鈴臥推', '胸', '槓鈴'),
    ('Decline_Barbell_Bench_Press', '下斜槓鈴臥推', '胸', '槓鈴'),
    ('Wide-Grip_Barbell_Bench_Press', '寬握槓鈴臥推', '胸', '槓鈴'),
    ('Barbell_Guillotine_Bench_Press', '斷頭台臥推', '胸', '槓鈴'),
    ('Pushups', '伏地挺身', '胸', '自重'),
    ('Push-Up_Wide', '寬距伏地挺身', '胸', '自重'),
    ('Incline_Push-Up', '上斜伏地挺身', '胸', '自重'),
    ('Push-Ups_With_Feet_Elevated', '下斜伏地挺身（腳墊高）', '胸', '自重'),
    ('Dips_-_Chest_Version', '雙槓撐體（胸）', '胸', '自重'),
    # 肩
    ('Standing_Military_Press', '槓鈴肩推', '肩', '槓鈴'),
    ('Seated_Barbell_Military_Press', '坐姿槓鈴肩推', '肩', '槓鈴'),
    ('Push_Press', '借力推', '肩', '槓鈴'),
    ('Upright_Barbell_Row', '槓鈴直立划船', '肩', '槓鈴'),
    ('Barbell_Rear_Delt_Row', '槓鈴後三角划船', '肩', '槓鈴'),
    ('Standing_Front_Barbell_Raise_Over_Head', '槓鈴前平舉', '肩', '槓鈴'),
    ('Handstand_Push-Ups', '倒立伏地挺身', '肩', '自重'),
    # 背
    ('Barbell_Deadlift', '硬舉', '背', '槓鈴'),
    ('Sumo_Deadlift', '相撲硬舉', '背', '槓鈴'),
    ('Rack_Pulls', '架上硬舉', '背', '槓鈴'),
    ('Bent_Over_Barbell_Row', '槓鈴划船', '背', '槓鈴'),
    ('Reverse_Grip_Bent-Over_Rows', '反握槓鈴划船', '背', '槓鈴'),
    ('T-Bar_Row_with_Handle', 'T 槓划船', '背', '槓鈴'),
    ('Barbell_Shrug', '槓鈴聳肩', '背', '槓鈴'),
    ('Pullups', '引體向上', '背', '自重'),
    ('Chin-Up', '反手引體向上', '背', '自重'),
    ('Weighted_Pull_Ups', '負重引體向上', '背', '自重'),
    ('Band_Assisted_Pull-Up', '彈力帶輔助引體向上', '背', '自重'),
    ('Wide-Grip_Rear_Pull-Up', '寬握頸後引體向上', '背', '自重'),
    ('Inverted_Row_with_Straps', '反式划船', '背', '自重'),
    ('Hyperextensions_Back_Extensions', '背伸展', '背', '自重'),
    ('Superman', '超人式', '背', '自重'),
    # 腿（含臀、小腿）
    ('Barbell_Squat', '槓鈴深蹲', '腿', '槓鈴'),
    ('Front_Barbell_Squat', '前蹲舉', '腿', '槓鈴'),
    ('Box_Squat', '箱上深蹲', '腿', '槓鈴'),
    ('Zercher_Squats', '澤奇深蹲', '腿', '槓鈴'),
    ('Barbell_Hack_Squat', '槓鈴哈克深蹲', '腿', '槓鈴'),
    ('Romanian_Deadlift', '羅馬尼亞硬舉', '腿', '槓鈴'),
    ('Stiff-Legged_Barbell_Deadlift', '直腿硬舉', '腿', '槓鈴'),
    ('Good_Morning', '早安式', '腿', '槓鈴'),
    ('Barbell_Lunge', '槓鈴弓箭步', '腿', '槓鈴'),
    ('Barbell_Walking_Lunge', '槓鈴行走弓箭步', '腿', '槓鈴'),
    ('Barbell_Step_Ups', '槓鈴登階', '腿', '槓鈴'),
    ('Barbell_Hip_Thrust', '臀推', '腿', '槓鈴'),
    ('Barbell_Glute_Bridge', '槓鈴臀橋', '腿', '槓鈴'),
    ('Standing_Barbell_Calf_Raise', '槓鈴站姿提踵', '腿', '槓鈴'),
    ('Goblet_Squat', '高腳杯深蹲', '腿', '啞鈴'),
    ('Dumbbell_Squat', '啞鈴深蹲', '腿', '啞鈴'),
    ('Plie_Dumbbell_Squat', '啞鈴相撲深蹲', '腿', '啞鈴'),
    ('Split_Squat_with_Dumbbells', '保加利亞分腿蹲', '腿', '啞鈴'),
    ('Dumbbell_Lunges', '啞鈴弓箭步', '腿', '啞鈴'),
    ('Dumbbell_Rear_Lunge', '啞鈴後跨弓箭步', '腿', '啞鈴'),
    ('Dumbbell_Step_Ups', '啞鈴登階', '腿', '啞鈴'),
    ('Stiff-Legged_Dumbbell_Deadlift', '啞鈴直腿硬舉', '腿', '啞鈴'),
    ('Standing_Dumbbell_Calf_Raise', '啞鈴站姿提踵', '腿', '啞鈴'),
    ('Pull_Through', '繩索後拉（臀）', '腿', '繩索'),
    ('One-Legged_Cable_Kickback', '繩索單腿後踢', '腿', '繩索'),
    ('Cable_Hip_Adduction', '繩索髖內收', '腿', '繩索'),
    ('Leg_Press', '腿推', '腿', '器械'),
    ('Hack_Squat', '哈克深蹲', '腿', '器械'),
    ('Smith_Machine_Squat', '史密斯深蹲', '腿', '器械'),
    ('Leg_Extensions', '腿伸展', '腿', '器械'),
    ('Lying_Leg_Curls', '俯臥腿後勾', '腿', '器械'),
    ('Seated_Leg_Curl', '坐姿腿後勾', '腿', '器械'),
    ('Standing_Calf_Raises', '站姿提踵機', '腿', '器械'),
    ('Seated_Calf_Raise', '坐姿提踵機', '腿', '器械'),
    ('Thigh_Abductor', '髖外展機', '腿', '器械'),
    ('Thigh_Adductor', '髖內收機', '腿', '器械'),
    ('Glute_Ham_Raise', '臀腿抬升（GHR）', '腿', '器械'),
    ('Bodyweight_Squat', '徒手深蹲', '腿', '自重'),
    ('Freehand_Jump_Squat', '跳躍深蹲', '腿', '自重'),
    ('Butt_Lift_Bridge', '臀橋', '腿', '自重'),
    ('Single_Leg_Glute_Bridge', '單腿臀橋', '腿', '自重'),
    ('Glute_Kickback', '跪姿後踢腿', '腿', '自重'),
    # 核心
    ('Hanging_Leg_Raise', '懸吊抬腿', '核心', '自重'),
    ('Hanging_Pike', '懸吊屈體抬腿', '核心', '自重'),
    ('Crunches', '捲腹', '核心', '自重'),
    ('Reverse_Crunch', '反向捲腹', '核心', '自重'),
    ('Sit-Up', '仰臥起坐', '核心', '自重'),
    ('Flat_Bench_Lying_Leg_Raise', '仰臥抬腿', '核心', '自重'),
    ('Plank', '棒式', '核心', '自重'),
    ('Side_Bridge', '側棒式', '核心', '自重'),
    ('Russian_Twist', '俄羅斯轉體', '核心', '自重'),
    ('Dead_Bug', '死蟲式', '核心', '自重'),
    ('Air_Bike', '空中腳踏車', '核心', '自重'),
    ('Ab_Roller', '健腹輪', '核心', '自重'),
    ('Landmine_180s', '地雷管轉體', '核心', '槓鈴'),
    ('Barbell_Ab_Rollout_-_On_Knees', '槓鈴滾輪', '核心', '槓鈴'),
    # 二頭
    ('Barbell_Curl', '槓鈴彎舉', '二頭', '槓鈴'),
    ('EZ-Bar_Curl', 'EZ 槓彎舉', '二頭', '槓鈴'),
    ('Preacher_Curl', '牧師椅彎舉', '二頭', '槓鈴'),
    ('Reverse_Barbell_Curl', '槓鈴反握彎舉', '二頭', '槓鈴'),
    ('Drag_Curl', '拖曳彎舉', '二頭', '槓鈴'),
    ('Spider_Curl', '蜘蛛彎舉', '二頭', '槓鈴'),
    # 三頭
    ('Close-Grip_Barbell_Bench_Press', '窄握臥推', '三頭', '槓鈴'),
    ('EZ-Bar_Skullcrusher', '仰臥三頭伸展（碎顱）', '三頭', '槓鈴'),
    ('JM_Press', 'JM 推舉', '三頭', '槓鈴'),
    ('Standing_Overhead_Barbell_Triceps_Extension', '槓鈴過頭三頭伸展', '三頭', '槓鈴'),
    ('Dips_-_Triceps_Version', '雙槓撐體（三頭）', '三頭', '自重'),
    ('Bench_Dips', '凳上撐體', '三頭', '自重'),
    ('Push-Ups_-_Close_Triceps_Position', '窄距伏地挺身', '三頭', '自重'),
]

# 舊版動作名稱 → 新名稱（舊紀錄自動改名）
LEGACY = {
    '上斜臥推': '上斜槓鈴臥推', '肩推': '槓鈴肩推', '二頭彎舉': '啞鈴二頭彎舉', '三頭下壓': '三頭繩索下壓',
    '下斜臥推': '下斜槓鈴臥推', '器械推胸': '坐姿胸推機', '器械夾胸': '蝴蝶機夾胸', '繩索夾胸': '繩索夾胸（高位交叉）',
    '雙槓撐體': '雙槓撐體（胸）', '滑輪下拉': '寬握滑輪下拉', '啞鈴單臂划船': '單臂啞鈴划船', '坐姿划船': '坐姿繩索划船',
    '器械划船': '槓桿式獨立划船機', '弓箭步': '啞鈴弓箭步', '腿後勾': '俯臥腿後勾', '小腿提踵': '站姿提踵機',
    '器械肩推': '槓桿式肩推機', '側平舉': '啞鈴側平舉', '繩索側平舉': '站姿低滑輪側平舉', '前平舉': '啞鈴前平舉',
    '反向飛鳥': '啞鈴反向飛鳥', '器械反向飛鳥': '反向蝴蝶機（後三角）', '直立划船': '槓鈴直立划船', '聳肩': '槓鈴聳肩',
    '啞鈴彎舉': '啞鈴二頭彎舉', '集中彎舉': '坐姿集中彎舉', '繩索彎舉': '站姿繩索二頭彎舉', '反握彎舉': '槓鈴反握彎舉',
    '繩索三頭下壓': '三頭繩索下壓', '直桿三頭下壓': '三頭下壓（直槓）', '仰臥三頭伸展': '仰臥三頭伸展（碎顱）',
    '過頭三頭伸展': '繩索過頭三頭伸展', '啞鈴三頭後伸': '啞鈴三頭後踢', '繩索捲腹': '繩索跪姿捲腹', '懸垂舉腿': '懸吊抬腿',
}

PART_ORDER = ['胸', '肩', '背', '腿', '核心', '二頭', '三頭']
EQUIP_ORDER = ['槓鈴', '啞鈴', '繩索', '器械', '自重']

def fetch(url, tries=4):
    for t in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.read()
        except Exception:
            time.sleep(2 ** t)
    raise RuntimeError('download failed: ' + url)

def main(list_path, db_path):
    db = {e['id']: e for e in json.load(open(db_path))}
    items = parse_list(list_path)
    for ex_id, name, part, equip in EXTRA:
        e = db[ex_id]
        lv = {'beginner': 1, 'intermediate': 2, 'expert': 3}[e['level']]
        items.append(dict(name=name, en=e['name'], part=part, equip=equip, level=lv, img=ex_id))
    names = [x['name'] for x in items]
    dup = {n for n in names if names.count(n) > 1}
    assert not dup, dup
    for old, new in LEGACY.items():
        assert new in names, new
    items.sort(key=lambda x: (PART_ORDER.index(x['part']), EQUIP_ORDER.index(x['equip'])))

    out_dir = os.path.join(ROOT, 'img', 'ex')
    os.makedirs(out_dir, exist_ok=True)
    for x in items:
        for k in (0, 1):
            dst = os.path.join(out_dir, f"{x['img']}-{k}.jpg")
            if os.path.exists(dst):
                continue
            im = Image.open(io.BytesIO(fetch(f"{RAW}{x['img']}/{k}.jpg"))).convert('RGB')
            im.thumbnail((300, 300))
            im.save(dst, 'JPEG', quality=62, optimize=True, progressive=True)

    rows = ',\n'.join(
        '  ' + json.dumps([x['name'], x['part'], x['equip'], x['en'], x['img'], x['level']], ensure_ascii=False)
        for x in items)
    js = ('/* 由 tools/build_exercises.py 產生，請勿手動修改。\n'
          ' * 資料與示範圖來源：free-exercise-db（https://github.com/yuhonas/free-exercise-db，Unlicense 公有領域）\n'
          ' * 欄位：[中文名, 部位, 器材, 英文名, 圖片 id, 難度 1-3] */\n'
          f'window.LIFTLOG_PARTS = {json.dumps(PART_ORDER, ensure_ascii=False)};\n'
          f'window.LIFTLOG_EQUIPS = {json.dumps(EQUIP_ORDER, ensure_ascii=False)};\n'
          f'window.LIFTLOG_LEGACY = {json.dumps(LEGACY, ensure_ascii=False)};\n'
          f'window.LIFTLOG_EXERCISES = [\n{rows}\n];\n')
    open(os.path.join(ROOT, 'exercises.js'), 'w', encoding='utf-8').write(js)
    print(len(items), 'exercises')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
