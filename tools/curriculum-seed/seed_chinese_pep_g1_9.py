#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐学期写入「语文-人教版」G1–G9（部编六三学制）单元目录。
不走 curriculum/import 整包覆盖，避免一次导入失败。

周次：教学 16 周（跳过第 9 周期中、第 18 周期末）。
课时：周课时 × 周数（G1–2 为 7，G3–9 为 6）。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("SUIS_API_URL", "http://127.0.0.1:8080/api").rstrip("/")
COURSE_NAME = os.environ.get("SUIS_CHINESE_COURSE", "语文-人教版")
ADMIN_USER = os.environ.get("SUIS_ADMIN_USER", "Admin")
ADMIN_PASS = os.environ.get("SUIS_ADMIN_PASS", "4321")

KC = {
    "审美": "审美 Aesthetics",
    "变化": "变化 Change",
    "交流": "交流 Communication",
    "社区": "社区 Communities",
    "关联": "关联 Connections",
    "创造力": "创造力 Creativity",
    "文化": "文化 Culture",
    "发展": "发展 Development",
    "形式": "形式 Form",
    "全球": "全球互动 Global interactions",
    "身份": "身份认同 Identity",
    "逻辑": "逻辑 Logic",
    "视角": "视角 Perspective",
    "关系": "关系 Relationships",
    "时空": "时间/地点/空间 Time/place/space",
    "系统": "系统 Systems",
}

TEACHING_WEEKS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]


def weekly_periods(grade: int) -> int:
    return 7 if grade <= 2 else 6


def format_week(chunk: list[int]) -> str:
    if len(chunk) == 1:
        return str(chunk[0])
    return f"{chunk[0]}-{chunk[-1]}"


def _even(total: int, parts: int) -> list[int]:
    base, rem = divmod(total, parts)
    return [base + (1 if i < rem else 0) for i in range(parts)]


def split_weeks(n: int) -> list[str]:
    """把 16 个教学周均分到 n 个单元；期中前 8 周与期中后 8 周分开，不跨第 9 周。"""
    if n <= 0:
        raise ValueError("unit count")
    n_left = max(1, min(n - 1, (n + 1) // 2))
    n_right = n - n_left
    sizes = _even(8, n_left) + _even(8, n_right)
    chunks: list[str] = []
    i = 0
    for sz in sizes:
        chunk = TEACHING_WEEKS[i : i + sz]
        if not chunk:
            raise RuntimeError("empty week chunk")
        covered = list(range(chunk[0], chunk[-1] + 1))
        if covered != chunk:
            raise RuntimeError(f"week gap inside {chunk}")
        chunks.append(format_week(chunk))
        i += sz
    if i != 16:
        raise RuntimeError(f"week coverage {i}")
    return chunks


def week_span(week: str) -> int:
    if "-" in week:
        a, b = week.split("-")
        return int(b) - int(a) + 1
    return 1


def unit(
    title: str,
    texts: str,
    task: str,
    extra: str,
    *concepts: str,
) -> dict:
    en = extra.strip()
    focus = f"主要篇目：{texts}。学习重点：{task}"
    if en:
        focus = f"{focus} {en}"
    return {
        "title": title,
        "focus": focus,
        "keyConcepts": [KC[c] for c in concepts],
    }


# grade -> semester -> list of unit dicts (title/focus/keyConcepts)
CATALOG: dict[int, dict[str, list[dict]]] = {
    1: {
        "Semester 1": [
            unit("入学教育：我上学了", "我是中国人；我是小学生；我爱学语文",
                 "认识校园与课堂常规，建立小学生身份，激发学语文的兴趣。口语交际：我说你做。",
                 "Build school routines and a first identity as a student of Chinese.",
                 "身份", "社区"),
            unit("识字（一）", "天地人；金木水火土；口耳目；日月水火；对韵歌",
                 "认识常用象形、会意字；诵读对韵，感受汉语节奏。语文园地一、快乐读书吧。",
                 "Learn pictographs and the cadence of rhyming couplets.",
                 "形式", "文化"),
            unit("汉语拼音（一）", "a o e；i u ü y w；b p m f；d t n l；g k h",
                 "读准单韵母与声母，能拼读简单音节，养成观察口型与声调的习惯。",
                 "Master basic initials, finals, and tones.",
                 "形式", "系统"),
            unit("汉语拼音（二）", "j q x；z c s；zh ch sh r；ai ei ui；ao ou iu",
                 "区分平翘舌与 jqx 的拼写规则，拼读复韵母音节。语文园地二。",
                 "Contrast retroflex sounds and compound finals.",
                 "形式", "逻辑"),
            unit("汉语拼音（三）", "ie üe er；an en in un ün；ang eng ing ong",
                 "掌握鼻韵母与整体认读，能给汉字注音并辅助识字。语文园地三。",
                 "Use pinyin as a tool for independent character learning.",
                 "系统", "发展"),
            unit("金秋童谣", "秋天；小小的船；江南；四季",
                 "朗读儿童诗与古诗，感受季节与想象；学习量词和生活用语。口语交际：我们做朋友。",
                 "Read seasonal poems and build oral friendship language.",
                 "审美", "变化"),
            unit("识字（二）", "画；大小多少；小书包；日月明；升国旗",
                 "在生活情境中识字，认识合体字与会意字；升国旗培养国家认同。",
                 "Connect characters to school life and national symbols.",
                 "形式", "身份"),
            unit("童趣观察", "影子；比尾巴；青蛙写诗；雨点儿",
                 "观察身边现象，读懂问答与拟人；练习用合适的音量说话。口语交际：用多大的声音。",
                 "Observe everyday phenomena through playful texts.",
                 "视角", "交流"),
            unit("想象与思考", "明天要远足；大还是小；项链；雪地里的小画家；乌鸦喝水；小蜗牛",
                 "体会等待、比较与合作；读简单叙事，了解动脑解决问题。口语交际：小兔运南瓜。",
                 "Follow simple narratives and problem-solving stories.",
                 "创造力", "逻辑"),
        ],
        "Semester 2": [
            unit("识字：四季与姓名", "春夏秋冬；姓氏歌；小青蛙；猜字谜",
                 "在四季词语、姓氏与字谜中识字，感受汉字趣味。口语交际：听故事，讲故事。",
                 "Learn characters through seasons, surnames, and riddles.",
                 "形式", "文化"),
            unit("心中有祖国", "吃水不忘挖井人；我多想去看看；一个接一个；四个太阳",
                 "了解革命传统与对首都的向往；展开色彩与季节想象。",
                 "Connect gratitude, national landmarks, and imagination.",
                 "身份", "时空"),
            unit("伙伴与快乐", "小公鸡和小鸭子；树和喜鹊；怎么都快乐",
                 "懂得互助与分享；发现不同玩法中的快乐。口语交际：请你帮个忙。",
                 "Practise helping language and cooperative play.",
                 "关系", "社区"),
            unit("家人与节日", "静夜思；夜色；端午粽；彩虹",
                 "诵读古诗，体会思乡与亲情；了解端午习俗。",
                 "Link classic poetry with family and festival culture.",
                 "文化", "关系"),
            unit("识字：对韵与校园", "动物儿歌；古对今；操场上；人之初",
                 "对对子、运动词语与蒙学名句，扩大识字量。口语交际：打电话。",
                 "Expand characters through couplets and school-life words.",
                 "形式", "交流"),
            unit("夏日观察", "古诗二首（池上、小池）；荷叶圆圆；要下雨了",
                 "观察荷叶、小动物与天气变化，学习预报生活现象。",
                 "Observe summer nature and weather clues.",
                 "变化", "审美"),
            unit("习惯与时间", "文具的家；一分钟；动物王国开大会；小猴子下山",
                 "爱惜文具、珍惜时间；读懂通知与做事要有始有终。口语交际：一起做游戏。",
                 "Build habits of care, punctuality, and following through.",
                 "发展", "系统"),
            unit("童话寓言", "棉花姑娘；咕咚；小壁虎借尾巴",
                 "读简单童话，了解互助、不盲目跟从与再生的科学趣味。",
                 "Retell fables and notice cause and effect.",
                 "创造力", "逻辑"),
        ],
    },
    2: {
        "Semester 1": [
            unit("自然的密码", "小蝌蚪找妈妈；我是什么；植物妈妈有办法",
                 "了解生长变化与水的形态；体会植物传播种子的办法。口语交际：有趣的动物。",
                 "Explore life cycles and how nature ‘solves’ problems.",
                 "变化", "系统"),
            unit("识字：场景与节令", "场景歌；树之歌；拍手歌；田家四季歌",
                 "在场景、树木、量词与农事歌谣中识字，感受汉语节奏。",
                 "Learn characters in scenes, trees, and seasonal songs.",
                 "形式", "时空"),
            unit("儿童生活", "曹冲称象；玲玲的画；一封信；妈妈睡了",
                 "学习动脑解决问题、补救过错、表达关心。口语交际：做手工。",
                 "Solve problems and express care in everyday life.",
                 "逻辑", "关系"),
            unit("祖国河山", "古诗二首（登鹳雀楼、望庐山瀑布）；黄山奇石；日月潭；葡萄沟",
                 "欣赏名胜与物产，体会对祖国山河的热爱。",
                 "Appreciate landscapes and regional culture of China.",
                 "审美", "文化"),
            unit("寓言智慧", "坐井观天；寒号鸟；我要的是葫芦",
                 "明白看问题要全面、不能懒惰、做事要关注过程。口语交际：商量。",
                 "Draw morals from fables about perspective and effort.",
                 "视角", "逻辑"),
            unit("英雄与传统", "大禹治水；朱德的扁担；难忘的泼水节",
                 "了解治水精神、革命传统与民族节日。口语交际：看图讲故事。",
                 "Connect legend, revolutionary memory, and festival culture.",
                 "身份", "文化"),
            unit("自然想象", "古诗二首（夜宿山寺、敕勒歌）；雾在哪里；雪孩子",
                 "感受边塞与山寺意境；展开对雾、雪的想象。",
                 "Imagine weather and landscape through poetry and story.",
                 "审美", "创造力"),
            unit("友谊与品质", "狐假虎威；狐狸分奶酪；纸船和风筝；风娃娃",
                 "辨别借势欺人与公平；学习交友与助人要适度。",
                 "Discuss fairness, friendship, and helping well.",
                 "关系", "交流"),
        ],
        "Semester 2": [
            unit("找春天", "古诗二首（村居、咏柳）；找春天；开满鲜花的小路；邓小平爷爷植树",
                 "发现春景，体会种树与呵护自然。口语交际：注意说话的语气。",
                 "Notice spring and practise considerate spoken tone.",
                 "变化", "审美"),
            unit("关爱他人", "雷锋叔叔，你在哪里；千人糕；一匹出色的马",
                 "学习助人、体会劳动协作与亲情陪伴。",
                 "Value helping, cooperation, and family companionship.",
                 "关系", "社区"),
            unit("识字：中华文化", "神州谣；传统节日；“贝”的故事；中国美食",
                 "在地名、节日、汉字源流与美食中识字。口语交际：长大以后做什么。",
                 "Learn characters through festivals, etymology, and food culture.",
                 "文化", "身份"),
            unit("童心想象", "彩色的梦；枫树上的喜鹊；沙滩上的童话；我是一只小虫子",
                 "展开色彩与视角想象，练习写话。",
                 "Write from imaginative and tiny-creature perspectives.",
                 "创造力", "视角"),
            unit("办法与观察", "寓言二则（亡羊补牢、揠苗助长）；画杨桃；小马过河",
                 "懂得补救、尊重事实、亲身实践。口语交际：图书借阅公约。",
                 "Learn from fables about evidence, practice, and rules.",
                 "逻辑", "视角"),
            unit("自然与科学", "古诗二首（晓出净慈寺送林子方、绝句）；雷雨；要是你在野外迷了路；太空生活趣事多",
                 "观察天气与方向，了解生活与太空常识。",
                 "Observe weather, outdoor orientation, and space life.",
                 "系统", "全球"),
            unit("童话世界", "大象的耳朵；蜘蛛开店；青蛙卖泥塘；小毛虫",
                 "读童话，体会接纳自己、坚持与成长。",
                 "Discuss self-acceptance and persistence in fairy tales.",
                 "身份", "发展"),
            unit("神话起源", "祖先的摇篮；当世界年纪还小的时候；羿射九日",
                 "感受创世想象与英雄传说。口语交际：推荐一部动画片。",
                 "Encounter origin myths and heroic legends.",
                 "文化", "创造力"),
        ],
    },
    3: {
        "Semester 1": [
            unit("校园生活", "大青树下的小学；花的学校；不懂就要问",
                 "感受多彩校园，敢于提问。口语交际：我的暑假生活。习作：猜猜他是谁。",
                 "Describe school life and practise asking questions.",
                 "社区", "交流"),
            unit("秋天的诗意", "古诗三首（山行、赠刘景文、夜书所见）；铺满金色巴掌的水泥道；秋天的雨；听听，秋的声音",
                 "体会秋景与拟人，学习写日记。习作：写日记。",
                 "Capture autumn imagery in poetry and journal writing.",
                 "审美", "变化"),
            unit("童话", "去年的树；那一定会很好；在牛肚子里旅行；一块奶酪",
                 "理解承诺、分享与想象旅行。习作：我来编童话。快乐读书吧。",
                 "Invent fairy tales about promises and sharing.",
                 "创造力", "关系"),
            unit("阅读策略：预测", "总也倒不了的老屋；胡萝卜先生的长胡子；不会叫的狗",
                 "根据题目、插图和情节预测，续写故事。口语交际：名字里的故事。习作：续写故事。",
                 "Predict plot from titles, pictures, and patterns.",
                 "逻辑", "视角"),
            unit("习作单元：观察", "搭船的鸟；金色的草地",
                 "细致观察事物特点，写缤纷世界。习作：我们眼中的缤纷世界。",
                 "Write from close observation of living things.",
                 "形式", "审美"),
            unit("祖国河山", "古诗三首（望天门山、饮湖上初晴后雨、望洞庭）；富饶的西沙群岛；海滨小城；美丽的小兴安岭",
                 "体会不同地域风光。习作：这儿真美。",
                 "Appreciate regional landscapes across China.",
                 "时空", "文化"),
            unit("大自然", "大自然的声音；父亲、树林和鸟；带刺的朋友",
                 "倾听自然，建立人与动物的友善关系。口语交际：身边的“小事”。习作：我有一个想法。",
                 "Listen to nature and propose small improvements.",
                 "关联", "交流"),
            unit("美好品质", "司马光；掌声；灰雀；手术台就是阵地",
                 "学习机智、尊重、诚实与责任。口语交际：请教。习作：那次玩得真高兴。",
                 "Discuss courage, respect, honesty, and responsibility.",
                 "身份", "关系"),
        ],
        "Semester 2": [
            unit("可爱的生灵", "古诗三首（绝句、惠崇春江晚景、三衢道中）；燕子；荷花；昆虫备忘录",
                 "观察动植物特点。口语交际：春游去哪儿玩。习作：我的植物朋友。",
                 "Observe plants and animals with precise detail.",
                 "审美", "形式"),
            unit("寓言", "守株待兔；陶罐和铁罐；狮子和鹿；池子与河流",
                 "明白道理要通过行动与辩证看待长短。口语交际：该不该实行班干部轮流制。习作：看图画，写作文。",
                 "Interpret fable morals and debate classroom roles.",
                 "逻辑", "视角"),
            unit("中华传统", "古诗三首（元日、清明、九月九日忆山东兄弟）；纸的发明；赵州桥；一幅名扬中外的画",
                 "了解节日、造纸与古代建筑艺术。综合性学习：中华传统节日。",
                 "Explore festivals, invention, and classical architecture.",
                 "文化", "时空"),
            unit("观察与实验", "花钟；蜜蜂；小虾",
                 "按顺序、抓特点写观察。习作：我做了一项小实验。",
                 "Record observations and a simple experiment.",
                 "系统", "逻辑"),
            unit("习作单元：想象", "小真的长头发；我变成了一棵树",
                 "大胆想象并写清楚变化过程。习作：奇妙的想象。",
                 "Write imaginative transformations with a clear sequence.",
                 "创造力", "形式"),
            unit("童年趣事", "童年的水墨画；剃头大师；肥皂泡；我不能失信",
                 "抓住人物特点与守信。习作：身边那些有特点的人。",
                 "Portray distinctive people and the value of keeping promises.",
                 "身份", "关系"),
            unit("大自然的奥秘", "我们奇妙的世界；海底世界；火烧云",
                 "用具体描写展现世界的奇妙。口语交际：劝说。习作：国宝大熊猫。",
                 "Describe wonders of land, sea, and sky; write to persuade.",
                 "全球", "交流"),
            unit("有趣的故事", "慢性子裁缝和急性子顾客；方帽子店；漏；枣核",
                 "感受幽默与民间故事智慧。口语交际：趣味故事会。习作：这样想象真有趣。",
                 "Retell humorous and folk stories with inventive twists.",
                 "创造力", "文化"),
        ],
    },
    4: {
        "Semester 1": [
            unit("自然之美", "观潮；走月亮；现代诗二首（秋晚的江上、花牛歌）；繁星",
                 "体会散文与现代诗的意境。口语交际：我们与环境。习作：推荐一个好地方。",
                 "Appreciate lyrical landscape prose and modern poetry.",
                 "审美", "时空"),
            unit("阅读策略：提问", "一个豆荚里的五粒豆；蝙蝠和雷达；呼风唤雨的世纪",
                 "从题目和文本提问，把阅读引向深处。",
                 "Ask questions that deepen scientific and narrative reading.",
                 "逻辑", "关联"),
            unit("观察发现", "古诗三首（暮江吟、题西林壁、雪梅）；爬山虎的脚；蟋蟀的住宅",
                 "抓住特点连续观察。口语交际：爱护眼睛，保护视力。习作：写观察日记。",
                 "Keep observation journals of plants and animals.",
                 "形式", "系统"),
            unit("神话传说", "盘古开天地；精卫填海；普罗米修斯；女娲补天",
                 "了解中外创世与英雄神话。习作：我和——过一天。快乐读书吧。",
                 "Compare creation myths and heroic resolve.",
                 "文化", "创造力"),
            unit("习作单元：写事", "风筝；麻雀",
                 "把一件事的经过写清楚。习作：生活万花筒。",
                 "Narrate a complete event with a clear sequence.",
                 "形式", "交流"),
            unit("童年成长", "牛和鹅；一只窝囊的大老虎；陀螺",
                 "真实写出心里的变化与游戏乐趣。",
                 "Write honest feelings about fear, pride, and play.",
                 "发展", "身份"),
            unit("家国情怀", "古诗三首（出塞、凉州词、夏日绝句）；为中华之崛起而读书；梅兰芳蓄须；延安，我把你追寻",
                 "理解志向、气节与革命传统。习作：写信。",
                 "Connect personal ambition with national memory.",
                 "身份", "时空"),
            unit("历史故事", "王戎不取道旁李；西门豹治邺；故事二则（扁鹊治病、纪昌学射）",
                 "读文言文故事，体会观察、治理与坚持。口语交际：讲历史故事。习作：我的心儿怦怦跳。",
                 "Retell historical anecdotes and classical fables.",
                 "文化", "逻辑"),
        ],
        "Semester 2": [
            unit("乡村生活", "古诗词三首（宿新市徐公店、四时田园杂兴、清平乐·村居）；乡下人家；天窗；三月桃花水",
                 "感受田园与童心。口语交际：转述。习作：我的乐园。",
                 "Portray rural life and a personal ‘paradise’.",
                 "时空", "审美"),
            unit("科普说明", "琥珀；飞向蓝天的恐龙；新奇的纳米技术",
                 "了解说明顺序与科学趣味。口语交际：说新闻。习作：我的奇思妙想。快乐读书吧：十万个为什么。",
                 "Read science explanations and invent a ‘what if’.",
                 "系统", "创造力"),
            unit("现代诗", "短诗三首（繁星选）；绿；白桦；在天晴了的时候",
                 "体会意象与情感。综合性学习：轻叩诗歌大门。",
                 "Read modern poems and try writing imagery.",
                 "审美", "形式"),
            unit("作家笔下的动物", "猫；母鸡；白鹅",
                 "比较不同作家写动物的方法。习作：我的动物朋友。",
                 "Compare authorial voices in animal sketches.",
                 "视角", "关系"),
            unit("习作单元：游记", "海上日出；记金华的双龙洞",
                 "按游览顺序写景物变化。习作：游——。",
                 "Write a visit in spatial and temporal order.",
                 "时空", "形式"),
            unit("成长故事", "小英雄雨来；我们家的男子汉",
                 "体会人物品质与家庭中的成长。口语交际：朋友相处的秘诀。习作：我学会了。",
                 "Write a ‘I learned to…’ growth narrative.",
                 "发展", "身份"),
            unit("人物品质", "古诗三首（芙蓉楼送辛渐、塞下曲、墨梅）；文言文二则（囊萤夜读、铁杵成针）；“诺曼底”号遇难记；记张自忠将军",
                 "学习气节、勤学与责任。口语交际：自我介绍。习作：我的“自画像”。",
                 "Link classical integrity with modern responsibility.",
                 "身份", "文化"),
            unit("童话故事", "宝葫芦的秘密；巨人的花园；海的女儿",
                 "讨论愿望、分享与牺牲。习作：故事新编。",
                 "Rewrite a fairy tale with a new twist.",
                 "创造力", "视角"),
        ],
    },
    5: {
        "Semester 1": [
            unit("万物有灵", "白鹭；落花生；桂花雨；珍珠鸟",
                 "体会借物抒情与事物蕴含的道理。口语交际：制定班级公约。习作：我的心爱之物。",
                 "Appreciate object-based emotion and write about a cherished object.",
                 "关联", "审美"),
            unit("阅读策略：提高阅读速度", "搭石；将相和；什么比猎豹的速度更快；冀中的地道战",
                 "连词成句读、抓住主旨，扩大视幅。习作：“漫画”老师。",
                 "Practise faster reading while keeping the main idea.",
                 "逻辑", "系统"),
            unit("民间故事", "猎人海力布；牛郎织女（一）（二）",
                 "把握故事情节与人物形象。口语交际：讲民间故事。习作：缩写故事。快乐读书吧。",
                 "Retell and condense folk narratives.",
                 "文化", "交流"),
            unit("家国情怀", "古诗三首（示儿、题临安邸、已亥杂诗）；少年中国说（节选）；圆明园的毁灭；木笛",
                 "理解爱国志与历史教训。习作：二十年后的家乡。",
                 "Connect patriotic verse with historical reflection.",
                 "身份", "时空"),
            unit("习作单元：说明文", "太阳；松鼠",
                 "抓住事物特点介绍。习作：介绍一种事物。",
                 "Explain an object by its distinctive features.",
                 "形式", "逻辑"),
            unit("父母之爱", "慈母情深；父爱之舟；“精彩极了”和“糟糕透了”",
                 "体会不同表达的爱。口语交际：父母之爱。习作：我想对您说。",
                 "Write a letter that voices family love with specifics.",
                 "关系", "交流"),
            unit("四季之美", "古诗词三首（山居秋暝、枫桥夜泊、长相思）；四季之美；鸟的天堂；月迹",
                 "学习景物描写。习作：——即景。",
                 "Paint a seasonal scene with precise imagery.",
                 "审美", "变化"),
            unit("读书明智", "古人谈读书；忆读书；我的“长生果”",
                 "借鉴读书方法，推荐好书。口语交际：我最喜欢的人物形象。习作：推荐一本书。",
                 "Reflect on reading methods and recommend a book.",
                 "发展", "交流"),
        ],
        "Semester 2": [
            unit("童年往事", "古诗三首（四时田园杂兴、稚子弄冰、村晚）；冬阳·童年·骆驼队；祖父的园子",
                 "抓住印象深刻的童年细节。口语交际：走进他们的童年岁月。习作：那一刻，我长大了。",
                 "Write a turning-point memory of growing up.",
                 "时空", "身份"),
            unit("古典名著", "草船借箭；景阳冈；猴王出世；红楼春趣",
                 "了解名著人物与情节。口语交际：我们都来演一演。习作：写读后感。快乐读书吧。",
                 "Encounter classic novel episodes and write a response.",
                 "文化", "视角"),
            unit("综合性学习：遨游汉字王国", "汉字真有趣；我爱你，汉字",
                 "探究汉字起源、趣味与规范，做一次小小研究。",
                 "Investigate Chinese characters as a living system.",
                 "形式", "文化"),
            unit("家国情怀", "古诗三首（凉州词、送元二使安西、秋夜将晓出篱门迎凉有感）；军神；清贫",
                 "体会意志、信念与家国担当。习作：他陶醉了。",
                 "Portray determination and patriotic conviction.",
                 "身份", "发展"),
            unit("习作单元：人物描写", "人物描写一组；刷子李",
                 "把一个人的特点写具体。习作：把一个人的特点写具体。",
                 "Show a person through action, speech, and detail.",
                 "形式", "身份"),
            unit("思维的火花", "自相矛盾；田忌赛马；跳水",
                 "学习辩证思考与因势利导。习作：神奇的探险之旅。",
                 "Apply logic and strategy in classical anecdotes.",
                 "逻辑", "创造力"),
            unit("世界各地", "威尼斯的小艇；牧场之国；金字塔",
                 "抓住特点介绍异域风情。口语交际：我是小小讲解员。习作：中国的世界文化遗产。",
                 "Guide listeners through a cultural heritage site.",
                 "全球", "交流"),
            unit("风趣与幽默", "杨氏之子；手指；童年的发现",
                 "体会语言的机智。口语交际：我们都来讲笑话。习作：漫画的启示。",
                 "Enjoy witty language and write a cartoon insight.",
                 "交流", "视角"),
        ],
    },
    6: {
        "Semester 1": [
            unit("触摸自然", "草原；丁香结；古诗词三首；花之歌",
                 "体会情景交融与咏物抒怀。习作：变形记。",
                 "Blend scene and feeling; try a transformation narrative.",
                 "审美", "关联"),
            unit("革命岁月", "七律·长征；狼牙山五壮士；开国大典；灯光",
                 "把握纪实与抒情，体会革命精神。口语交际：演讲。习作：多彩的活动。",
                 "Read historical narrative and practise a short speech.",
                 "身份", "时空"),
            unit("生活与探究", "竹节人；宇宙生命之谜；故宫博物院",
                 "学习选择材料、说明顺序与非连续性文本。习作：——让生活更美好。",
                 "Navigate informational and non-continuous texts.",
                 "系统", "逻辑"),
            unit("情感抉择", "桥；穷人；在柏林",
                 "体会人物在危难中的选择。口语交际：请你支持我。习作：笔尖流出的故事。快乐读书吧。",
                 "Analyse moral choices under pressure.",
                 "关系", "视角"),
            unit("习作单元：围绕中心意思写", "夏天里的成长；盼",
                 "围绕中心选择材料。习作：围绕中心意思写。",
                 "Select details that serve one controlling idea.",
                 "形式", "发展"),
            unit("保护家园", "古诗三首；只有一个地球；三黑和土地；青山不老",
                 "树立环保与土地情怀。口语交际：意见不同怎么办。习作：学写倡议书。",
                 "Write a proposal that argues for the living environment.",
                 "全球", "交流"),
            unit("艺术与经典", "文言文二则（伯牙鼓琴、书戴嵩画牛）；月光曲；京剧趣谈",
                 "感受知音、艺术与传统。口语交际：聊聊书法。习作：我的拿手好戏。",
                 "Connect classical arts with a personal ‘signature skill’.",
                 "文化", "审美"),
            unit("走近鲁迅", "少年闰土；好的故事；我的伯父鲁迅先生；有的人",
                 "初步认识鲁迅作品与人格。习作：有你，真好。",
                 "Meet Lu Xun through memory, image, and tribute.",
                 "身份", "视角"),
        ],
        "Semester 2": [
            unit("民风民俗", "北京的春节；腊八粥；古诗三首；藏戏",
                 "了解节日与地方戏曲。习作：家乡的风俗。",
                 "Write a custom from home with cultural detail.",
                 "文化", "社区"),
            unit("外国名著", "鲁滨孙漂流记（梗概+节选）；骑鹅旅行记（节选）；汤姆·索亚历险记（节选）",
                 "把握梗概与人物。口语交际：同读一本书。习作：写作品梗概。快乐读书吧。",
                 "Summarise a novel excerpt and discuss it with peers.",
                 "全球", "发展"),
            unit("真情流露", "匆匆；那个星期天",
                 "体会时间与情感的表达。习作：让真情自然流露。",
                 "Let genuine feeling shape a personal narrative.",
                 "变化", "关系"),
            unit("理想信念", "古诗三首（马诗、石灰吟、竹石）；十六年前的回忆；为人民服务；金色的鱼钩",
                 "理解志向、信仰与牺牲。口语交际：即兴发言。习作：心愿。",
                 "Speak and write about a heartfelt wish and conviction.",
                 "身份", "发展"),
            unit("科学精神", "文言文二则（学弈、两小儿辩日）；表里的生物；真理诞生于一百个问号之后；150年后，我们这样上学",
                 "敢于提问、求证。口语交际：辩论。习作：插上科学的翅膀。",
                 "Practise questioning, evidence, and a science-themed piece.",
                 "逻辑", "系统"),
            unit("综合性学习：难忘小学生活", "回忆往事；依依惜别；古诗词诵读",
                 "整理小学生活记忆，学写临别赠言，复习古诗词。",
                 "Curate primary-school memories and farewell writing.",
                 "身份", "社区"),
        ],
    },
    7: {
        "Semester 1": [
            unit("四季美景", "春；济南的冬天；雨的四季；古代诗歌四首（观沧海、闻王昌龄左迁龙标遥有此寄、次北固山下、天净沙·秋思）",
                 "学习写景抒情。写作：热爱生活，热爱写作。",
                 "Read seasonal essays and classical landscape poems.",
                 "审美", "变化"),
            unit("至爱亲情", "秋天的怀念；散步；散文诗两首（金色花、荷叶·母亲）；《世说新语》二则",
                 "体会亲情与人物细节。写作：学会记事。综合性学习：有朋自远方来。",
                 "Narrate family moments with concrete detail.",
                 "关系", "交流"),
            unit("学习生活", "从百草园到三味书屋；再塑生命的人；《论语》十二章；名著导读《朝花夕拾》",
                 "认识成长与为学。写作：写人要抓住特点。",
                 "Portray mentors and the attitude of learning.",
                 "发展", "文化"),
            unit("人生之舟", "纪念白求恩；植树的牧羊人；走一步，再走一步；诫子书",
                 "思考责任、坚持与修身。写作：思路要清晰。综合性学习：少年正是读书时。",
                 "Organise ideas about responsibility and perseverance.",
                 "身份", "发展"),
            unit("动物与人", "猫；动物笑谈；狼",
                 "比较散文、科学小品与文言文叙事。写作：如何突出中心。",
                 "Compare human–animal bonds across genres.",
                 "视角", "关联"),
            unit("想象之翼", "皇帝的新装；天上的街市；女娲造人；寓言四则；名著导读《西游记》",
                 "发挥联想和想象。写作：发挥联想和想象。综合性学习：文学部落。",
                 "Practise imaginative writing and mythic narrative.",
                 "创造力", "文化"),
        ],
        "Semester 2": [
            unit("杰出人物", "邓稼先；说和做——记闻一多先生言行片段；回忆鲁迅先生（节选）；孙权劝学",
                 "写出人物精神。写作：写出人物的精神。",
                 "Show character through speech, action, and anecdote.",
                 "身份", "发展"),
            unit("家国情怀", "黄河颂；老山界；土地的誓言；木兰诗",
                 "学习抒情与家国叙事。写作：学习抒情。综合性学习：天下国家。",
                 "Read patriotic lyric and wartime narrative.",
                 "身份", "时空"),
            unit("平凡之光", "阿长与《山海经》；老王；台阶；卖油翁；名著导读《骆驼祥子》",
                 "关注小人物与细节。写作：抓住细节。",
                 "Honour ordinary lives through selected detail.",
                 "视角", "关系"),
            unit("修身正己", "叶圣陶先生二三事；驿路梨花；最苦与最乐；短文两篇（陋室铭、爱莲说）",
                 "理解修养与品格。写作：怎样选材。综合性学习：孝亲敬老，从我做起。",
                 "Select material that reveals integrity and care.",
                 "文化", "身份"),
            unit("哲理之思", "紫藤萝瀑布；一棵小桃树；外国诗二首；古代诗歌五首",
                 "托物言志，文从字顺。写作：文从字顺。",
                 "Write reflective prose inspired by images and poems.",
                 "审美", "变化"),
            unit("探险与科幻", "伟大的悲剧；太空一日；带上她的眼睛；河中石兽；名著导读《海底两万里》",
                 "说明顺序与语言简明。写作：语言简明。综合性学习：我的语文生活。",
                 "Read exploration/science texts and write with concision.",
                 "全球", "逻辑"),
        ],
    },
    8: {
        "Semester 1": [
            unit("活动探究：新闻", "消息二则；首届诺贝尔奖颁发；“飞天”凌空；一着惊海天；国行公祭，为佑世界和平",
                 "学习新闻要素、采访与写作。任务：新闻采访、新闻写作。口语交际：讲述。",
                 "Analyse news structure and produce a short report.",
                 "交流", "全球"),
            unit("回忆性散文", "藤野先生；回忆我的母亲；列夫·托尔斯泰；美丽的颜色",
                 "抓住人物与事件写传记。写作：学写传记。综合性学习：人无信不立。",
                 "Write a biographical sketch from selected memories.",
                 "身份", "关系"),
            unit("山川之美", "三峡；短文二篇（答谢中书书、记承天寺夜游）；与朱元思书；唐诗五首；名著导读《红星照耀中国》",
                 "学习描写景物。写作：学习描写景物。",
                 "Read classical landscape prose and Tang poems.",
                 "审美", "时空"),
            unit("哲理散文", "背影；白杨礼赞；散文二篇；昆明的雨",
                 "体会抒情与象征。写作：语言要连贯。综合性学习：我们的互联网时代。",
                 "Practise coherent lyrical prose.",
                 "关联", "交流"),
            unit("说明文", "中国石拱桥；苏州园林；蝉；梦回繁华；名著导读《昆虫记》",
                 "说明事物要抓住特征。写作：说明事物要抓住特征。口语交际：复述与转述。",
                 "Explain objects and gardens by distinctive features.",
                 "形式", "系统"),
            unit("古代诗文", "《孟子》三章；愚公移山；周亚夫军细柳；诗词五首",
                 "理解儒家理念与叙事写人。写作：表达要得体。综合性学习：身边的文化遗产。",
                 "Read Mencius and classical narrative with appropriate register.",
                 "文化", "逻辑"),
        ],
        "Semester 2": [
            unit("民风民俗", "社戏；回延安；安塞腰鼓；灯笼",
                 "感受民俗与抒情。写作：学习仿写。口语交际：应对。",
                 "Imitate lyrical folk writing and practise spoken response.",
                 "文化", "身份"),
            unit("事理说明", "大自然的语言；阿西莫夫短文两篇；大雁归来；时间的脚印",
                 "说明的顺序与科学思维。写作：说明的顺序。综合性学习：倡导低碳生活。",
                 "Explain processes and argue for low-carbon living.",
                 "系统", "全球"),
            unit("古代山水记", "桃花源记；小石潭记；核舟记；《诗经》二首；名著导读《傅雷家书》",
                 "体会意境与托物。写作：学写读后感。综合性学习：古诗苑漫步。",
                 "Read classical travel notes and write a response.",
                 "审美", "时空"),
            unit("活动探究：演讲", "最后一次讲演；应有格物致知精神；我一生中的重要抉择；庆祝奥林匹克运动复兴25周年",
                 "学习演讲词，撰写并举办演讲。",
                 "Analyse, write, and deliver a speech.",
                 "交流", "视角"),
            unit("现代游记", "壶口瀑布；在长江源头各拉丹冬；登勃朗峰；一滴水经过丽江",
                 "学写游记。写作：学写游记。口语交际：即席讲话。",
                 "Write a travel piece and speak off the cuff.",
                 "时空", "审美"),
            unit("诸子与唐诗", "《庄子》二则；《礼记》二则；马说；唐诗二首；名著导读《钢铁是怎样炼成的》",
                 "理解思想与叙事。写作：学写故事。综合性学习：以和为贵。",
                 "Connect classical thought with story writing.",
                 "文化", "逻辑"),
        ],
    },
    9: {
        "Semester 1": [
            unit("活动探究：诗歌", "沁园春·雪；我爱这土地；乡愁；你是人间的四月天；我看；名著导读《艾青诗选》",
                 "学习诵读与诗歌创作。任务：自由朗诵、尝试创作。",
                 "Recite modern verse and try writing a short poem.",
                 "审美", "身份"),
            unit("议论立德", "敬业与乐业；就英法联军远征中国致巴特勒上尉的信；论教养；精神的三间小屋",
                 "观点要明确。写作：观点要明确。综合性学习：君子自强不息。",
                 "State a clear claim about work, dignity, and self-cultivation.",
                 "身份", "交流"),
            unit("古代山水记", "岳阳楼记；醉翁亭记；湖心亭看雪；诗词三首",
                 "议论要言之有据，体会古仁人用心。写作：议论要言之有据。",
                 "Read classical essays that fuse landscape and argument.",
                 "文化", "视角"),
            unit("小说天地", "故乡；我的叔叔于勒；孤独之旅",
                 "把握人物、情节与主题。写作：学习缩写。综合性学习：走进小说天地。",
                 "Analyse fiction and practise condensation.",
                 "视角", "关系"),
            unit("思辨议论", "中国人失掉自信力了吗；怀疑与学问；谈创造性思维；创造宣言",
                 "论证要合理。写作：论证要合理。口语交际：讨论。",
                 "Build reasoned argument and creative thinking.",
                 "逻辑", "创造力"),
            unit("古典小说", "智取生辰纲；范进中举；三顾茅庐；刘姥姥进大观园；名著导读《水浒传》",
                 "学习改写。写作：学习改写。",
                 "Read classic novel episodes and try a rewrite.",
                 "文化", "形式"),
        ],
        "Semester 2": [
            unit("祖国之歌", "祖国啊，我亲爱的祖国；梅岭三章；短诗五首；海燕",
                 "学习扩写与意象。写作：学习扩写。",
                 "Expand poetic imagery of homeland and struggle.",
                 "身份", "审美"),
            unit("小说人物", "孔乙己；变色龙；溜索；蒲柳人家（节选）",
                 "审题立意，分析人物。写作：审题立意。综合性学习：岁月如歌——我们的初中生活。",
                 "Analyse character and reflect on junior-high years.",
                 "视角", "身份"),
            unit("古代议论", "鱼我所欲也；唐雎不辱使命；送东阳马生序；词四首；名著导读《儒林外史》",
                 "布局谋篇，理解义利与为学。写作：布局谋篇。",
                 "Plan argumentative essays rooted in classical texts.",
                 "文化", "逻辑"),
            unit("文艺短论", "短文两篇（谈读书、不求甚解）；山水画的意境；无言之美；驱遣我们的想象",
                 "修改润色。写作：修改润色。口语交际：辩论。",
                 "Revise for style; debate ideas about reading and art.",
                 "审美", "交流"),
            unit("活动探究：戏剧", "屈原（节选）；天下第一楼（节选）；枣儿",
                 "阅读、排练与演出评议。",
                 "Read drama and stage a scene with peer review.",
                 "交流", "形式"),
            unit("历史与责任", "曹刿论战；邹忌讽齐王纳谏；出师表；诗词曲五首；名著导读《简·爱》",
                 "有创意地表达。写作：有创意地表达。",
                 "Read historical counsel and write with originality.",
                 "时空", "身份"),
        ],
    },
}


def build_units(grade: int, semester: str, raw: list[dict]) -> list[dict]:
    weeks = split_weeks(len(raw))
    wp = weekly_periods(grade)
    stamp = f"zh-g{grade}-{'s1' if semester.endswith('1') else 's2'}"
    out = []
    for i, item in enumerate(raw):
        w = weeks[i]
        out.append({
            "id": f"unit-{stamp}-{i}",
            "title": item["title"],
            "focus": item["focus"],
            "keyConcepts": item["keyConcepts"],
            "week": w,
            "periods": wp * week_span(w),
            "order": i,
        })
    return out


def request_json(method: str, url: str, token: str | None = None, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"{method} {url} -> {e.code}: {detail}") from e


def login() -> str:
    body = request_json("POST", f"{API}/auth/login", payload={"username": ADMIN_USER, "password": ADMIN_PASS})
    token = body.get("token")
    if not token:
        raise RuntimeError(f"login failed: {body}")
    return token


def find_course_id(token: str, name: str) -> str:
    raw = request_json("GET", f"{API}/courses", token=token)
    courses = raw if isinstance(raw, list) else raw.get("courses", [])
    hits = [c for c in courses if isinstance(c, dict) and str(c.get("name", "")).strip() == name]
    if not hits:
        names = [str(c.get("name", "")) for c in courses if isinstance(c, dict)]
        raise RuntimeError(f"course not found: {name!r}; available: {names}")
    return str(hits[0]["id"])


def main() -> int:
    token = login()
    course_id = find_course_id(token, COURSE_NAME)
    print(f"Using {COURSE_NAME} id={course_id} via {API}")
    ok, fail = 0, []
    for grade in range(1, 10):
        for semester in ("Semester 1", "Semester 2"):
            raw = CATALOG[grade][semester]
            units = build_units(grade, semester, raw)
            payload = {
                "courseId": course_id,
                "grade": grade,
                "semester": semester,
                "units": units,
            }
            try:
                saved = request_json("POST", f"{API}/semester", token=token, payload=payload)
                n = len(saved.get("units") or [])
                titles = " / ".join(u["title"] for u in units)
                print(f"OK  G{grade} {semester}: {n} units | {titles}")
                ok += 1
            except Exception as e:
                print(f"FAIL G{grade} {semester}: {e}", file=sys.stderr)
                fail.append((grade, semester, str(e)))
    print(f"\nDone: {ok}/18 semesters saved, {len(fail)} failed.")
    if fail:
        return 1

    # 回读校验
    for grade in range(1, 10):
        for semester in ("Semester 1", "Semester 2"):
            url = f"{API}/semester/{course_id}/{grade}/{urllib.parse.quote(semester)}"
            data = request_json("GET", url, token=token)
            n = len(data.get("units") or [])
            expect = len(CATALOG[grade][semester])
            if n != expect:
                print(f"VERIFY FAIL G{grade} {semester}: got {n}, expect {expect}", file=sys.stderr)
                return 1
    print("Verify: all 18 semesters match catalog unit counts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
