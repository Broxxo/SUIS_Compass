#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐学期写入美术、音乐 G1–G9（人教《艺术·美术》《艺术·音乐》）。
不走 curriculum/import 整包覆盖。

小学 G1–G3、初中 G7 及已换新的册次用 2024 新课标；
尚未全面换新的小学中高年级、部分初中下册按现行人教目录归并为河图单元。
周次：16 个教学周（跳过第 9、18 周）。课时沿用并补齐课程已设周课时。
标题与学习重点中英对照。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("SUIS_API_URL", "http://127.0.0.1:8080/api").rstrip("/")
ADMIN_USER = os.environ.get("SUIS_ADMIN_USER", "Admin")
ADMIN_PASS = os.environ.get("SUIS_ADMIN_PASS", "4321")

MUSIC_NAME = os.environ.get("SUIS_MUSIC_COURSE", "音乐-人民音乐")
ART_NAME = os.environ.get("SUIS_ART_COURSE", "美术-人民美术")

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
G1_9 = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g10"]


def format_week(chunk: list[int]) -> str:
    if len(chunk) == 1:
        return str(chunk[0])
    return f"{chunk[0]}-{chunk[-1]}"


def _even(total: int, parts: int) -> list[int]:
    base, rem = divmod(total, parts)
    return [base + (1 if i < rem else 0) for i in range(parts)]


def split_weeks(n: int) -> list[str]:
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


def unit(title: str, content: str, task: str, extra: str, *concepts: str) -> dict:
    focus = f"主要内容：{content} Main content: {extra} 学习重点：{task}"
    return {
        "title": title,
        "focus": focus,
        "keyConcepts": [KC[c] for c in concepts],
    }


MUSIC: dict[int, dict[str, list[dict]]] = {
    1: {
        "Semester 1": [
            unit("第一单元 奇妙的声音世界 / Unit 1 A Wonderful World of Sound",
                 "丰富多彩的声音；世界音乐博览会；神奇的嗓音；班级音乐会。",
                 "用耳朵发现生活与音乐中的声音，尝试控制音量。Learning focus: notice sounds around us and control our own volume.",
                 "Everyday sounds, voices, instruments and a class concert.",
                 "审美", "交流"),
            unit("第二–三单元 节奏与旋律密码 / Units 2–3 Rhythm and Melody Codes",
                 "均拍、音符与休止符；《祖国祖国我们爱你》；简谱 do re mi；《娃哈哈》《洋娃娃和小熊跳舞》。",
                 "认识基本节奏与旋律，跟唱简单歌曲。Learning focus: pulse, notes, rests and singing simple tunes.",
                 "Beat, notes, rests, solfège and first songs.",
                 "形式", "系统"),
            unit("第四–五单元 打击乐与弹拨乐 / Units 4–5 Percussion and Plucked Instruments",
                 "身体打击乐与课堂打击乐器；《数鸭子》；高山流水；小小作曲家；《快乐的罗梭》。",
                 "用打击乐和弹拨乐感受音色，做简单即兴。Learning focus: percussion, plucked timbres and simple composing.",
                 "Body percussion, classroom instruments and plucked strings.",
                 "形式", "创造力"),
            unit("第六–八单元 管乐、弓弦与春天 / Units 6–8 Winds, Strings and Spring",
                 "吹管乐家族；国歌与《共产儿童团歌》；小提琴与小夜曲；音乐剧《唤醒春天》。",
                 "认识管乐与弓弦音色，用歌声迎接春天。Learning focus: winds, bowed strings, the national anthem and a spring musical.",
                 "Winds, bowed strings, anthem singing and waking spring.",
                 "文化", "审美"),
        ],
        "Semester 2": [
            unit("第一单元 爱的摇篮 / Unit 1 A Cradle of Love",
                 "摇篮曲；爱的传递；《游子吟》。",
                 "用轻柔的歌声感受亲情。Learning focus: lullabies and songs about family love.",
                 "Lullabies and passing love through song.",
                 "关系", "审美"),
            unit("第二–三单元 朋友与绿色家园 / Units 2–3 Friends and Green Homes",
                 "你是我的好朋友；绿色家园。",
                 "用歌曲表达友爱与爱护自然。Learning focus: friendship songs and caring for nature.",
                 "Friendship and looking after our green home.",
                 "关系", "全球"),
            unit("第四–五单元 转转转与劳动最光荣 / Units 4–5 Spinning Games and Honouring Work",
                 "一二三，转转转；劳动最光荣。",
                 "在游戏节奏中唱歌，用歌曲赞美劳动。Learning focus: singing games and songs that honour work.",
                 "Circle games, pulse and songs about work.",
                 "交流", "发展"),
            unit("第六–八单元 生活、动画与童话歌 / Units 6–8 Life, Cartoons and Fairy-tale Songs",
                 "生活中的音乐；动画城；两只老虎与小兔乖乖。",
                 "从生活和动画里找音乐，唱熟童话歌曲。Learning focus: music in daily life, cartoons and story songs.",
                 "Everyday music, cartoon tunes and fairy-tale songs.",
                 "文化", "创造力"),
        ],
    },
    2: {
        "Semester 1": [
            unit("第一–二单元 京腔京味与燕赵津门 / Units 1–2 Beijing Opera Flavour and Yan-Zhao",
                 "京腔京味儿；燕赵大地连津门。",
                 "感受京津冀戏曲与民歌风味。Learning focus: Beijing opera colour and songs of Hebei and Tianjin.",
                 "Jingju flavour and music of the Beijing–Hebei–Tianjin region.",
                 "文化", "时空"),
            unit("第三单元 八月十五月儿圆 / Unit 3 The Mid-Autumn Moon",
                 "八月十五月儿圆。",
                 "用歌声迎接中秋团圆。Learning focus: Mid-Autumn songs about the full moon.",
                 "Festival songs for the Mid-Autumn moon.",
                 "文化", "社区"),
            unit("第四–五单元 中州之声与齐风鲁韵 / Units 4–5 Songs of Zhongzhou and Qilu",
                 "中州之声；齐风鲁韵。",
                 "学唱河南、山东民歌片段，比较地方风格。Learning focus: folk styles of Henan and Shandong.",
                 "Henan and Shandong folk colours.",
                 "文化", "形式"),
            unit("第六–八单元 律动、四季与蜗牛黄鹂 / Units 6–8 Pulse, Seasons and the Snail",
                 "摇曳的律动；四季的颜色；蜗牛与黄鹂鸟。",
                 "用身体律动感受拍子，唱四季与童话歌曲。Learning focus: movement to the beat, seasons and a story song.",
                 "Pulse, seasonal colours and The Snail and the Oriole.",
                 "变化", "审美"),
        ],
        "Semester 2": [
            unit("第一单元 美妙的和声 / Unit 1 Beautiful Harmony",
                 "美妙的和声。",
                 "听辨简单高低声部，尝试轻声合唱。Learning focus: hear and try simple two-part harmony.",
                 "High and low parts singing together.",
                 "形式", "关系"),
            unit("第二–五单元 东北音画 / Units 2–5 Sound Pictures of the Northeast",
                 "高高的兴安岭；长白山下；辽沈风情。",
                 "学唱东北民歌风味歌曲，感受地域音画。Learning focus: folk colours of Greater Khingan, Changbai and Liaoshen.",
                 "Songs of Xing’an, Changbai and Liaoning–Shenyang.",
                 "文化", "时空"),
            unit("第三·六单元 水态万千与音乐大比拼 / Units 3 & 6 Waters and Music Challenges",
                 "水态万千；音乐大比拼。",
                 "用声音表现水的形态，在竞赛中复习所学。Learning focus: water in music and a class music challenge.",
                 "Water sounds and a friendly music contest.",
                 "变化", "交流"),
            unit("第七–八单元 奥林匹克风与月饼歌 / Units 7–8 Olympic Spirit and Mooncake Song",
                 "奥林匹克风；爷爷为我打月饼。",
                 "唱体育与亲情主题歌曲，感受力量与团圆。Learning focus: Olympic spirit songs and a family mooncake song.",
                 "Sport, energy and a grandpa’s mooncake song.",
                 "全球", "关系"),
        ],
    },
    3: {
        "Semester 1": [
            unit("第一单元 谢谢您，亲爱的老师 / Unit 1 Thank You, Dear Teacher",
                 "谢谢您，亲爱的老师。",
                 "用歌声表达对老师的尊敬与感谢。Learning focus: songs of thanks to teachers.",
                 "Grateful songs for teachers.",
                 "关系", "交流"),
            unit("第二单元 德奥音乐之旅 / Unit 2 A Musical Journey to Germany and Austria",
                 "德奥音乐之旅。",
                 "欣赏德奥经典儿童曲目，感受古典风格。Learning focus: listen to German and Austrian classics for children.",
                 "German and Austrian classical colour.",
                 "全球", "审美"),
            unit("第三–五单元 三晋三秦与花儿 / Units 3–5 Shanxi, Shaanxi and Hua’er",
                 "人说山西好风光；走进三秦颂延安；西北高原唱花儿。",
                 "学唱山西、陕西与西北花儿，比较高原民歌。Learning focus: folk songs of Shanxi, Shaanxi and northwest Hua’er.",
                 "Shanxi scenery, Yan’an songs and plateau Hua’er.",
                 "文化", "时空"),
            unit("第六单元 东郭先生与狼 / Unit 6 Mr Dongguo and the Wolf",
                 "东郭先生与狼。",
                 "用歌唱和表演讲音乐故事。Learning focus: tell a music-theatre fable.",
                 "A sung story: Mr Dongguo and the Wolf.",
                 "创造力", "视角"),
        ],
        "Semester 2": [
            unit("第一单元 江南丝竹 / Unit 1 Jiangnan Silk and Bamboo",
                 "江南水乡音调；丝竹乐欣赏与学唱。",
                 "感受江南丝竹的细腻与水乡意境。Learning focus: the gentle colour of Jiangnan silk-and-bamboo music.",
                 "Jiangnan folk and silk-and-bamboo ensembles.",
                 "文化", "审美"),
            unit("第二单元 巴蜀云贵风情 / Unit 2 Sichuan, Yunnan and Guizhou",
                 "巴蜀号子与云南、贵州民歌片段。",
                 "比较西南民歌的节奏与音色。Learning focus: folk colours of Sichuan, Yunnan and Guizhou.",
                 "Southwest folk songs and work chants.",
                 "文化", "时空"),
            unit("第三单元 岭南佳音 / Unit 3 Lingnan Melodies",
                 "广东音乐与客家、潮汕音调。",
                 "听辨岭南音乐的明亮与装饰音。Learning focus: Guangdong music and Lingnan folk colour.",
                 "Cantonese music and Lingnan folk tunes.",
                 "文化", "形式"),
            unit("第四单元 音乐小剧场 / Unit 4 Mini Music Theatre",
                 "综合演唱、律动与简单戏剧表演。",
                 "把本学期歌曲编成班级小剧场。Learning focus: turn songs into a short class performance.",
                 "Singing, movement and a mini music play.",
                 "创造力", "交流"),
        ],
    },
    4: {
        "Semester 1": [
            unit("第一单元 东海渔歌 / Unit 1 East China Sea Fishing Songs",
                 "赶海的小姑娘；大海啊，故乡；小螺号；捕鱼归来。",
                 "学唱渔歌，认识附点与反复记号。Learning focus: fishing songs and basic score markings.",
                 "Sea songs, dotted notes and repeat signs.",
                 "文化", "形式"),
            unit("第二单元 音乐中的故事 / Unit 2 Stories in Music",
                 "草原放牧；老鼠和大象；哪吒再生；守株待兔。",
                 "听乐讲故事，做简单情景表演。Learning focus: follow a story in music and act it out.",
                 "Programme music and musical storytelling.",
                 "视角", "创造力"),
            unit("第三–四单元 田野与山乡牧童 / Units 3–4 Fields and Mountain Herdboys",
                 "我们的田野；田野在召唤；村晚；牧童短笛；牧童。",
                 "唱田园歌曲，欣赏贺绿汀《牧童短笛》。Learning focus: pastoral songs and The Herdboy’s Flute.",
                 "Fields, villages and He Luting’s piano piece.",
                 "审美", "时空"),
            unit("第五–六单元 节日与八音盒 / Units 5–6 Festivals and a Music Box",
                 "快乐的泼水节；金蛇狂舞；那达慕之歌；侗家儿童多快乐；匈牙利舞曲。",
                 "用歌曲感受民族节日，听赏舞曲。Learning focus: festival songs and dance music, including a music-box colour.",
                 "Water-splashing, Naadam, Dong songs and Brahms’s Hungarian Dance.",
                 "文化", "全球"),
        ],
        "Semester 2": [
            unit("第一单元 水乡与船歌 / Unit 1 Water Towns and Boat Songs",
                 "水乡音调；船歌与江南民歌。",
                 "用连贯的声音唱水乡船歌。Learning focus: legato singing of water-town and boat songs.",
                 "Canals, boats and Jiangnan song.",
                 "时空", "审美"),
            unit("第二单元 风景如画 / Unit 2 Picturesque Landscapes",
                 "描绘山川湖海的歌曲与乐曲。",
                 "听乐想象画面，用歌声画风景。Learning focus: music that paints landscapes.",
                 "Songs and pieces that describe scenery.",
                 "审美", "视角"),
            unit("第三单元 童心与课余 / Unit 3 Childlike Heart and After School",
                 "课余生活、游戏与少年歌曲。",
                 "选择适合自己的声音演唱少年歌曲。Learning focus: songs of play, school life and growing up.",
                 "Playtime, after-school life and children’s songs.",
                 "身份", "交流"),
            unit("第四单元 管弦的声音 / Unit 4 The Sound of Orchestra",
                 "认识常见管弦乐器音色；合奏片段欣赏。",
                 "听辨弦乐、木管、铜管与打击乐。Learning focus: recognise orchestral families by timbre.",
                 "Strings, woodwind, brass and percussion.",
                 "形式", "系统"),
        ],
    },
    5: {
        "Semester 1": [
            unit("第一单元 朝夕与足迹 / Unit 1 Dawn, Dusk and Footprints",
                 "朝夕；足迹；少年歌曲。",
                 "用有表情的声音唱描写时间与成长的歌。Learning focus: songs of morning, evening and growing footprints.",
                 "Times of day and songs about growing up.",
                 "变化", "身份"),
            unit("第二单元 农家乐与故乡 / Unit 2 Farm Life and Hometown",
                 "农家乐；故乡。",
                 "唱乡土歌曲，体会劳动与家乡情。Learning focus: rural life and hometown feeling in song.",
                 "Farm work and songs of home.",
                 "社区", "文化"),
            unit("第三单元 冬雪与节日 / Unit 3 Winter Snow and Festivals",
                 "冬雪；节庆合唱。",
                 "用和谐的声部表现冬日与节日气氛。Learning focus: winter songs and festival chorus.",
                 "Snow, winter colour and celebration.",
                 "审美", "文化"),
            unit("第四单元 合唱的默契 / Unit 4 The Art of Singing Together",
                 "二声部合唱基础；呼吸与咬字。",
                 "学会看指挥、稳住自己的声部。Learning focus: two-part singing, breathing and diction.",
                 "Chorus skills: parts, blend and following a conductor.",
                 "关系", "系统"),
        ],
        "Semester 2": [
            unit("第一单元 春意与家园 / Unit 1 Spring and Home",
                 "春意；美丽的家园。",
                 "用明亮的声音唱春天与家园。Learning focus: spring songs and songs of home.",
                 "Spring colour and beautiful homelands.",
                 "变化", "社区"),
            unit("第二单元 欢乐的村寨 / Unit 2 Joyful Villages",
                 "少数民族村寨歌舞。",
                 "学一段简单的民族歌舞。Learning focus: village songs and dances of ethnic groups.",
                 "Folk song and dance from village life.",
                 "文化", "交流"),
            unit("第三单元 京韵 / Unit 3 Beijing Opera Colour",
                 "京剧行当与经典唱段片段。",
                 "模仿简单京韵，了解皮黄与锣鼓。Learning focus: a first taste of jingju melody and percussion.",
                 "Sheng, dan, jing, chou and jingju percussion.",
                 "文化", "形式"),
            unit("第四单元 百花争艳 / Unit 4 A Hundred Flowers",
                 "中外名曲选听与班级音乐会。",
                 "选择曲目举办班级音乐会。Learning focus: a class concert of favourite pieces.",
                 "A bouquet of songs and a class concert.",
                 "审美", "创造力"),
        ],
    },
    6: {
        "Semester 1": [
            unit("第一单元 青春放歌 / Unit 1 Songs of Youth",
                 "青春放歌；校园歌曲。",
                 "用有气息支持的声音唱少年之歌。Learning focus: songs of youth with better breath support.",
                 "Youth, campus life and stronger singing.",
                 "发展", "身份"),
            unit("第二单元 草原牧歌 / Unit 2 Pastoral Songs of the Steppe",
                 "草原牧歌；长调与马头琴音色。",
                 "感受草原音乐的辽阔与自由节拍。Learning focus: grassland songs, long-tune and morin khuur colour.",
                 "Steppe songs and Mongolian musical colour.",
                 "文化", "时空"),
            unit("第三单元 京腔京韵 / Unit 3 Jingju Melody",
                 "京腔京韵；选段学唱。",
                 "巩固京剧韵味，尝试简单身段配合。Learning focus: jingju melody with simple movement.",
                 "Beijing opera singing and gesture.",
                 "文化", "形式"),
            unit("第四单元 月光与聆听 / Unit 4 Moonlight and Listening",
                 "月光；中外夜曲与钢琴小品。",
                 "安静聆听并记录感受。Learning focus: listen to nocturnes and describe what we hear.",
                 "Moonlight, nocturnes and reflective listening.",
                 "审美", "视角"),
        ],
        "Semester 2": [
            unit("第一单元 长江之歌 / Unit 1 Song of the Yangtze",
                 "长江之歌；江河主题合唱。",
                 "用有气势的合唱表现大江东去。Learning focus: powerful chorus on river themes.",
                 "The Yangtze and songs of great rivers.",
                 "时空", "审美"),
            unit("第二单元 终生的朋友 / Unit 2 Friends for Life",
                 "友谊歌曲；毕业寄语。",
                 "为同学唱一首友谊之歌。Learning focus: friendship songs at the end of primary school.",
                 "Friendship and farewell songs.",
                 "关系", "交流"),
            unit("第三单元 周游世界 / Unit 3 Around the World",
                 "世界民歌与舞曲选听。",
                 "比较不同国家的节奏与调式色彩。Learning focus: folk songs and dances from around the world.",
                 "A musical tour of world folk styles.",
                 "全球", "文化"),
            unit("第四单元 毕业音乐会 / Unit 4 Graduation Concert",
                 "班级毕业音乐会策划与演出。",
                 "合作完成一场毕业音乐会。Learning focus: plan and perform a graduation concert.",
                 "Programme planning, rehearsal and performance.",
                 "创造力", "社区"),
        ],
    },
    7: {
        "Semester 1": [
            unit("第一单元 生活中的音乐 / Unit 1 Music in Daily Life",
                 "生活中的音乐；音乐开启心灵之窗；学习乐谱，记录你的音乐生活。",
                 "发现生活中的音乐，用乐谱记录所听所唱。Learning focus: music in life and writing it down in notation.",
                 "Everyday music, listening journals and basic notation.",
                 "关联", "系统"),
            unit("第二单元 多彩的音乐风格 / Unit 2 Colourful Musical Styles",
                 "中国音乐万花筒；世界民族音乐博览会；合唱《茉莉花》。",
                 "比较中国各地与世界民族音乐风格。Learning focus: Chinese regional styles and world folk music.",
                 "A kaleidoscope of Chinese music and a world folk expo.",
                 "文化", "全球"),
            unit("第三单元 中国音乐的历史进程 / Unit 3 The Journey of Chinese Music",
                 "中国音乐考古博物馆；中国近现代音乐风云录；歌唱我们的祖国。",
                 "从考古遗存到近现代作品，理解中国音乐发展。Learning focus: Chinese music from archaeology to modern songs of the nation.",
                 "Music archaeology, modern Chinese music and patriotic song.",
                 "时空", "文化"),
            unit("第四单元 西方音乐发展史掠影 / Unit 4 A Glimpse of Western Music History",
                 "从古希腊到古典主义；音乐中的浪漫主义；20 世纪西方音乐轨迹。",
                 "抓住西方音乐主要时期的听觉特征。Learning focus: Classical, Romantic and 20th-century Western styles by ear.",
                 "From ancient Greece to the twentieth century.",
                 "变化", "审美"),
        ],
        "Semester 2": [
            unit("第一单元 音乐中的科学 / Unit 1 Science in Music",
                 "声音的振动与传播；音高、力度与音色的物理基础。",
                 "用实验理解乐音的科学原理。Learning focus: vibration, pitch, dynamics and timbre.",
                 "How sound works: vibration, pitch and colour.",
                 "系统", "逻辑"),
            unit("第二单元 歌唱的艺术 / Unit 2 The Art of Singing",
                 "人声分类；合唱与重唱；发声与咬字。",
                 "按声部合作合唱，注意呼吸与和谐。Learning focus: voice types, ensemble singing and diction.",
                 "Voice types, choir and vocal technique.",
                 "形式", "交流"),
            unit("第三单元 民族管弦的风采 / Unit 3 The Colours of Chinese Orchestra",
                 "吹、拉、弹、打；民乐合奏与代表曲目。",
                 "听辨民族管弦乐器并了解合奏编制。Learning focus: Chinese orchestral families and ensemble works.",
                 "Winds, bowed and plucked strings, percussion in a Chinese orchestra.",
                 "文化", "系统"),
            unit("第四单元 音乐与戏剧影视 / Unit 4 Music, Theatre and Film",
                 "戏曲片段；影视主题音乐；综合表演。",
                 "分析音乐如何推动情节与情感。Learning focus: how music supports drama, opera and film.",
                 "Opera, film themes and music for the stage.",
                 "关联", "视角"),
        ],
    },
    8: {
        "Semester 1": [
            unit("第一单元 音乐与诗歌 / Unit 1 Music and Poetry",
                 "诗词歌曲；艺术歌曲；吟诵与旋律。",
                 "为短诗选择或创编合适的旋律。Learning focus: how melody carries poetry.",
                 "Art song, ci poetry settings and melody.",
                 "审美", "文化"),
            unit("第二单元 中国戏曲与曲艺 / Unit 2 Chinese Opera and Narrative Song",
                 "京剧、地方戏与曲艺唱腔。",
                 "比较不同剧种的板式与行当。Learning focus: jingju and other opera/quyi vocal styles.",
                 "Opera genres, banqiang and quyi storytelling.",
                 "文化", "形式"),
            unit("第三单元 世界民族音乐深化 / Unit 3 World Music in Depth",
                 "亚洲、非洲、欧美民间音乐选听。",
                 "用节奏和调式特征辨认地区风格。Learning focus: identify world folk styles by rhythm and mode.",
                 "Folk traditions across continents.",
                 "全球", "视角"),
            unit("第四单元 室内乐与交响 / Unit 4 Chamber Music and Symphony",
                 "室内乐编制；交响乐队；主题发展。",
                 "跟随主题听一首交响乐章。Learning focus: chamber vs orchestra and following a theme.",
                 "Chamber groups, orchestra and thematic development.",
                 "系统", "形式"),
        ],
        "Semester 2": [
            unit("第一单元 歌剧与音乐剧 / Unit 1 Opera and Musical Theatre",
                 "咏叹调与对白歌曲；音乐剧选段。",
                 "比较歌剧与音乐剧的演唱与舞台。Learning focus: arias, songs and staging in opera and musicals.",
                 "Opera arias and songs from musicals.",
                 "文化", "交流"),
            unit("第二单元 影视音乐 / Unit 2 Music for Screen",
                 "主题曲、配乐与音画同步。",
                 "为短视频选择或说明配乐意图。Learning focus: how film music supports picture and emotion.",
                 "Themes, underscoring and picture–sound.",
                 "关联", "审美"),
            unit("第三单元 流行与当代 / Unit 3 Popular and Contemporary Music",
                 "流行歌曲结构；当代创作与传媒。",
                 "理性聆听流行音乐的旋律、和声与制作。Learning focus: melody, harmony and production in pop.",
                 "Popular song form and contemporary sounds.",
                 "变化", "社区"),
            unit("第四单元 音乐与社会 / Unit 4 Music and Society",
                 "仪式、庆典与公共空间中的音乐。",
                 "讨论音乐在社会生活中的功能。Learning focus: what music does in ceremonies and public life.",
                 "Ritual, celebration and music in the community.",
                 "社区", "全球"),
        ],
    },
    9: {
        "Semester 1": [
            unit("第一单元 怎样欣赏音乐 / Unit 1 How to Listen",
                 "聆听方法；主题、结构与风格判断。",
                 "用简洁语言写下有依据的听后感。Learning focus: listen with a method—theme, form and style.",
                 "Informed listening: theme, structure and style.",
                 "逻辑", "审美"),
            unit("第二单元 中华优秀传统音乐 / Unit 2 Fine Traditional Chinese Music",
                 "古曲、文人音乐、民间与宫廷传统。",
                 "从一件传统作品谈文化内涵。Learning focus: traditional Chinese masterworks and their culture.",
                 "Ancient tunes, literati music and folk heritage.",
                 "文化", "时空"),
            unit("第三单元 西方经典名作 / Unit 3 Western Masterworks",
                 "奏鸣曲、交响曲与歌剧选段。",
                 "抓住一部名作的主题与情感发展。Learning focus: follow a Western masterwork from theme to close.",
                 "Sonata, symphony and opera excerpts.",
                 "形式", "发展"),
            unit("第四单元 音乐创作入门 / Unit 4 A First Step in Composing",
                 "动机发展；简易编创与记谱。",
                 "用动机发展完成 8～16 小节小品。Learning focus: develop a motive into a short piece.",
                 "Motive, phrase and simple notation of one’s own idea.",
                 "创造力", "系统"),
        ],
        "Semester 2": [
            unit("第一单元 音乐与人生 / Unit 1 Music and Life",
                 "音乐在成长、情感与记忆中的意义。",
                 "选一首“我的歌”说明理由。Learning focus: choose a song that matters and say why.",
                 "Personal listening histories and why music matters.",
                 "身份", "关系"),
            unit("第二单元 当代音乐文化 / Unit 2 Music Culture Today",
                 "传媒、版权与跨界融合。",
                 "讨论当代音乐生活中的责任与选择。Learning focus: media, copyright and crossover in today’s music.",
                 "Media, rights and blending of styles.",
                 "全球", "视角"),
            unit("第三单元 校园音乐会 / Unit 3 School Concert",
                 "节目策划、排练与舞台礼仪。",
                 "参与或组织一场校园音乐会。Learning focus: programme, rehearsal and stage manners.",
                 "Planning, rehearsing and presenting a concert.",
                 "社区", "交流"),
            unit("第四单元 毕业放歌 / Unit 4 Graduation Songs",
                 "毕业合唱与班级音乐纪念。",
                 "用合唱为初中生活画上句点。Learning focus: a graduation chorus to close junior high.",
                 "Farewell chorus and a class music keepsake.",
                 "发展", "关系"),
        ],
    },
}

ART: dict[int, dict[str, list[dict]]] = {
    1: {
        "Semester 1": [
            unit("第一单元 龙的传人 / Unit 1 Descendants of the Dragon",
                 "我的名字；生肖大家庭；龙的故事；灵动的龙；中秋月儿圆。",
                 "用绘画和手工表现名字、生肖、龙与中秋。Learning focus: names, zodiac animals, dragons and the Mid-Autumn moon.",
                 "Names, zodiac, dragon stories and mooncakes.",
                 "身份", "文化"),
            unit("第二单元 奉献最美 / Unit 2 The Beauty of Giving",
                 "落叶去哪儿了；勤劳的蚕宝宝；寸草心。",
                 "观察自然与亲情，用作品表达感谢。Learning focus: fallen leaves, silkworms and gratitude.",
                 "Leaves, silkworms and a grateful heart.",
                 "关系", "审美"),
            unit("第三单元 成长足迹 / Unit 3 Footprints of Growing Up",
                 "新龟兔赛跑；蜗牛的坚持；看我七十二变。",
                 "用连环画和造型表现坚持与变化。Learning focus: persistence, change and playful transformation.",
                 "Fables, snails and ‘72 transformations’.",
                 "发展", "变化"),
            unit("第四单元 我的祖国 / Unit 4 My Motherland",
                 "红星闪闪；时光记忆；山河新貌；星辰大海。",
                 "用色彩表现祖国山河、记忆与向往。Learning focus: red stars, memories, landscapes and looking to the sea of stars.",
                 "National symbols, memory, rivers-and-mountains and the future.",
                 "文化", "时空"),
        ],
        "Semester 2": [
            unit("第一单元 大地母亲 / Unit 1 Mother Earth",
                 "春天在哪里；春天的使者；大地的肌理；自然的馈赠。",
                 "用线条和材料表现春天与大地肌理。Learning focus: spring, texture of the earth and gifts of nature.",
                 "Spring, texture, messengers of the season and natural materials.",
                 "审美", "变化"),
            unit("第二单元 时空印迹 / Unit 2 Traces of Time",
                 "远古的信息；前人的巧思；文物修复师；丝路的故事。",
                 "从文物与丝路认识时间里的巧思。Learning focus: ancient marks, clever making, restoration and the Silk Road.",
                 "Ancient signs, craft, restoration and Silk Road stories.",
                 "时空", "文化"),
            unit("第三单元 身边的人 / Unit 3 People Around Us",
                 "致敬平凡；守护生命；创造奇迹。",
                 "为身边的劳动者画像或做手工致敬。Learning focus: honour ordinary people who protect and create.",
                 "Everyday heroes, carers and makers.",
                 "社区", "关系"),
            unit("第四单元 家的故事 / Unit 4 Stories of Home",
                 "走进旧时光；难忘的童年；家乡变化大。",
                 "用画面记录家与家乡的变化。Learning focus: old times, childhood and a changing hometown.",
                 "Family memory, childhood and hometown change.",
                 "身份", "变化"),
        ],
    },
    2: {
        "Semester 1": [
            unit("第一单元 身边的自然 / Unit 1 Nature Nearby",
                 "树叶的“血管”；拼摆的乐趣；与风做朋友；吹皱的水波。",
                 "观察叶脉、风与水波并用材料表现。Learning focus: leaf veins, collage, wind and ripples.",
                 "Veins, arranging, wind and water.",
                 "形式", "审美"),
            unit("第二单元 爱我家园 / Unit 2 I Love My Home",
                 "多样的窗；独特的建筑；校园小导游；回家路上。",
                 "观察窗、建筑与回家路，做校园导览画。Learning focus: windows, buildings, campus and the way home.",
                 "Windows, architecture, campus guides and the road home.",
                 "社区", "时空"),
            unit("第三单元 我是小工匠 / Unit 3 I Am a Little Maker",
                 "有序地缠绕；声音的秘密；玩具的巧思；稳稳当当。",
                 "用缠绕、发声和结构做出稳固的小制作。Learning focus: winding, sound toys and stable structures.",
                 "Winding, sound, clever toys and balance.",
                 "创造力", "系统"),
            unit("第四单元 寻找年味儿 / Unit 4 Finding the Taste of New Year",
                 "指尖撕撕乐；窗头春意浓；福叠绵绵意。",
                 "用撕纸、窗花和折纸表现年味。Learning focus: tearing, window decorations and folded ‘fu’.",
                 "Tear-paper, window flowers and New Year blessings.",
                 "文化", "审美"),
        ],
        "Semester 2": [
            unit("第一单元 我们的游戏 / Unit 1 Our Games",
                 "孩童时光；玩转季节色；指尖动物园；纸偶奇遇记。",
                 "用色彩和纸偶表现游戏与季节。Learning focus: play, seasonal colour, fingertip animals and paper puppets.",
                 "Childhood games, seasons, animals and paper puppets.",
                 "创造力", "交流"),
            unit("第二单元 人类的朋友 / Unit 2 Friends of Humankind",
                 "动物与植物伙伴的观察与表现。",
                 "为一种动物或植物朋友做造型。Learning focus: observe and portray animal and plant friends.",
                 "Animals and plants as companions.",
                 "关系", "审美"),
            unit("第三单元 我们的约定 / Unit 3 Our Promises",
                 "规则、合作与班级公约的视觉表达。",
                 "把“我们的约定”做成图画或招贴。Learning focus: turn class promises into pictures or posters.",
                 "Rules, cooperation and visual agreements.",
                 "社区", "交流"),
            unit("第四单元 长大以后 / Unit 4 When I Grow Up",
                 "职业想象与未来的我。",
                 "画一画长大以后的自己。Learning focus: imagine a future self and a job through art.",
                 "Future me and jobs in pictures.",
                 "发展", "身份"),
        ],
    },
    3: {
        "Semester 1": [
            unit("第一单元 童年生活——美术作品欣赏 / Unit 1 Childhood in Art",
                 "童年艺趣；童真时光；定格纯真。",
                 "欣赏表现童年的中外作品并谈感受。Learning focus: look at artworks about childhood and talk about feelings.",
                 "Children’s games, memory and capturing innocence.",
                 "审美", "视角"),
            unit("第二单元 我和家人——学画人物画 / Unit 2 My Family — Figure Drawing",
                 "表情变变变；其乐融融；幸福一家亲。",
                 "抓住表情画家人，表现团圆气氛。Learning focus: expressions and a happy family picture.",
                 "Faces, family scenes and togetherness.",
                 "关系", "形式"),
            unit("第三单元 爱集体 爱劳动 / Unit 3 Love the Group, Love Work",
                 "班级的姓氏；我们爱劳动；劳作之美。",
                 "用画面表现集体与劳动之美。Learning focus: class identity and the beauty of labour.",
                 "Surnames in the class, labour and craft.",
                 "社区", "文化"),
            unit("第四单元 走进儿童剧 / Unit 4 Into Children’s Theatre",
                 "我们的舞台；走进儿童剧。",
                 "为儿童剧设计简单人物或场景。Learning focus: stage, characters and a children’s play.",
                 "The stage and designing for a children’s play.",
                 "创造力", "交流"),
        ],
        "Semester 2": [
            unit("第一单元 陶器世界——彩陶艺术欣赏 / Unit 1 The World of Pottery",
                 "彩陶纹样、器形与古代生活。",
                 "欣赏彩陶并临摹简单纹样。Learning focus: painted pottery shapes and patterns.",
                 "Neolithic painted pottery and pattern.",
                 "文化", "形式"),
            unit("第二单元 继往开来——学习制陶工艺 / Unit 2 Clay Skills, Then and Now",
                 "永恒的记忆；红色的烙印；胜利的号角。",
                 "用泥板成型做革命文物题材小陶塑。Learning focus: slab building and clay works with red-culture themes.",
                 "Memory, Long March relics and a clay bugle.",
                 "文化", "创造力"),
            unit("第三单元 节气里的美术 / Unit 3 Art in the Solar Terms",
                 "用色彩和造型表现节气与物候。",
                 "选一个节气完成一幅作品。Learning focus: seasons, solar terms and nature in art.",
                 "Solar terms, plants and seasonal colour.",
                 "时空", "变化"),
            unit("第四单元 饮食健康——将数据可视化 / Unit 4 Food, Health and Data Pictures",
                 "把饮食与健康信息画成图表或招贴。",
                 "用图形把一份健康数据说清楚。Learning focus: turn food-and-health data into a clear picture.",
                 "Healthy eating posters and simple infographics.",
                 "逻辑", "社区"),
        ],
    },
    4: {
        "Semester 1": [
            unit("第一单元 初识青铜器 / Unit 1 First Look at Bronzes",
                 "青铜器的器形、纹饰与礼制。",
                 "临摹或改绘一件青铜纹样。Learning focus: bronze forms, patterns and ritual meaning.",
                 "Shang–Zhou bronzes and taotie patterns.",
                 "文化", "形式"),
            unit("第二单元 三星堆遐想 / Unit 2 Imagining Sanxingdui",
                 "三星堆面具、神树与想象造型。",
                 "用夸张造型做一件三星堆风格作品。Learning focus: Sanxingdui masks and imaginative form.",
                 "Masks, sacred trees and bold bronze faces.",
                 "视角", "创造力"),
            unit("第三单元 鱼鸟生趣 / Unit 3 Fish and Birds",
                 "群鱼戏清波；处处闻啼鸟。",
                 "用重复和疏密表现鱼群与鸟鸣。Learning focus: schools of fish, birdsong and pattern in nature.",
                 "Fish in waves and birds among branches.",
                 "审美", "形式"),
            unit("第四单元 旧物变新颜 / Unit 4 New Life for Old Things",
                 "旧物改造与环保设计。",
                 "把一件旧物改造成新作品。Learning focus: upcycle an object into something new.",
                 "Reuse, redesign and giving old things a new face.",
                 "创造力", "全球"),
        ],
        "Semester 2": [
            unit("第一单元 点线面与构图 / Unit 1 Point, Line, Plane and Composition",
                 "聚聚散散；点的魅力；五谷作画；主题与背景。",
                 "用点线面和材料组织画面。Learning focus: gathering/scattering, dots, grain collage and figure–ground.",
                 "Dots, lines, grain pictures and composition.",
                 "形式", "逻辑"),
            unit("第二单元 色彩的表情 / Unit 2 The Face of Colour",
                 "色彩的明与暗；渐变；色彩的情感。",
                 "用明暗和渐变表达一种情绪。Learning focus: light/dark, gradients and feeling in colour.",
                 "Value, gradients and emotional colour.",
                 "审美", "变化"),
            unit("第三单元 动漫与春天 / Unit 3 Comics and Spring",
                 "我画的动漫形象；对称的美；那一刻的我；走进春天。",
                 "设计动漫形象并画春天里的自己。Learning focus: cartoon characters, symmetry, a frozen moment and spring.",
                 "Anime/comics, symmetry and spring scenes.",
                 "创造力", "身份"),
            unit("第四单元 版画、设计与国宝 / Unit 4 Prints, Design and National Treasures",
                 "吹塑纸版画；藏书票；文化衫；帽子；秦始皇陵兵马俑。",
                 "做一件小版画或设计，并欣赏兵马俑。Learning focus: simple prints, wearable design and the Terracotta Army.",
                 "Printmaking, T-shirts, hats and Qin bronzes/terracotta.",
                 "文化", "系统"),
        ],
    },
    5: {
        "Semester 1": [
            unit("第一单元 汉字传情——书法篆刻赏析 / Unit 1 Feeling in Chinese Characters",
                 "汉字的魅力；金石方寸间；云从锦书来。",
                 "欣赏书法篆刻，尝试基本笔画与一方小印。Learning focus: calligraphy, seals and the beauty of characters.",
                 "Calligraphy, seal carving and letters as pictures.",
                 "文化", "形式"),
            unit("第二单元 书画同源 / Unit 2 Painting and Calligraphy from One Source",
                 "传情达意的汉字；方寸有天地。",
                 "把字与画结合起来完成一件小品。Learning focus: how writing and painting share the same brush idea.",
                 "Brush, character and picture together.",
                 "关联", "审美"),
            unit("第三单元 书籍设计 / Unit 3 Designing a Book",
                 "封面与插画；学习制作连环画；制作立体书。",
                 "设计封面或做一本小立体书。Learning focus: covers, comics and a simple pop-up book.",
                 "Book covers, sequential pictures and pop-ups.",
                 "创造力", "系统"),
            unit("第四单元 数字时代 / Unit 4 The Digital Age",
                 "探索数字媒体艺术；数字美术。",
                 "用数字工具完成一幅简单作品。Learning focus: try digital tools for image-making.",
                 "Pixels, simple digital art and new media.",
                 "发展", "视角"),
        ],
        "Semester 2": [
            unit("第一单元 形与雕塑 / Unit 1 Form and Sculpture",
                 "形的魅力；形体的组合；抽象的雕塑。",
                 "用组合形体做一件小雕塑。Learning focus: shape, combining forms and abstract sculpture.",
                 "Form, assembly and abstract 3D work.",
                 "形式", "创造力"),
            unit("第二单元 写生与表情 / Unit 2 Drawing and Expression",
                 "学构图；静物写生；喜怒哀乐；夸张的脸。",
                 "写生静物并画夸张表情。Learning focus: composition, still life and expressive faces.",
                 "Still life, composition and exaggerated emotion.",
                 "视角", "审美"),
            unit("第三单元 写意与生肖 / Unit 3 Freehand Ink and the Zodiac",
                 "写意蔬果；写意动物；学画松树；十二生肖。",
                 "用写意笔法画蔬果、动物或生肖。Learning focus: freehand ink fruit, animals, pine and zodiac.",
                 "Xieyi fruit, animals, pine trees and the twelve animals.",
                 "文化", "形式"),
            unit("第四单元 玩具、舞台与青铜 / Unit 4 Toys, Stage and Bronzes",
                 "风筝；微观世界；会亮的玩具；小布偶；舞台布景；古代青铜艺术。",
                 "做一件玩具或布景，并欣赏青铜器。Learning focus: kites, toys, puppets, stage sets and ancient bronzes.",
                 "Kites, tiny worlds, puppets, sets and bronze treasures.",
                 "创造力", "文化"),
        ],
    },
    6: {
        "Semester 1": [
            unit("第一单元 线与色彩造型 / Unit 1 Line and Colour",
                 "流动的线条；色彩写生与和谐对比。",
                 "用线和色彩完成一幅有主题的画。Learning focus: expressive line and organised colour.",
                 "Line, colour harmony and contrast.",
                 "形式", "审美"),
            unit("第二单元 中国画小品 / Unit 2 A Small Chinese Painting",
                 "花鸟或山水小品；题款与印章意识。",
                 "完成一幅有题款的中国画小品。Learning focus: a small bird-and-flower or landscape painting.",
                 "Ink, wash, inscription and seal.",
                 "文化", "审美"),
            unit("第三单元 生活中的设计 / Unit 3 Design in Daily Life",
                 "包装、标志或招贴的基础设计。",
                 "为校园或生活做一个小设计。Learning focus: simple graphic or product design for real use.",
                 "Logos, packaging and posters.",
                 "系统", "创造力"),
            unit("第四单元 文化遗产在身边 / Unit 4 Heritage Around Us",
                 "家乡文物、古建或非遗的观察与表现。",
                 "记录一件身边的文化遗产。Learning focus: notice and portray local heritage.",
                 "Local relics, old buildings and living heritage.",
                 "时空", "社区"),
        ],
        "Semester 2": [
            unit("第一单元 明暗、立体与美的踪迹 / Unit 1 Light, Volume and Finding Beauty",
                 "明暗与立体；寻找美的踪迹；记录色彩。",
                 "用明暗表现体积，并外出记录色彩。Learning focus: light and shade, volume and colour notes outdoors.",
                 "Chiaroscuro, looking for beauty and colour records.",
                 "形式", "视角"),
            unit("第二单元 雕、刻与扇面 / Unit 2 Carve, Engrave and Fan Painting",
                 "雕与刻的乐趣；浮雕；扇面画；工笔花卉。",
                 "做一件浮雕或扇面工笔小品。Learning focus: relief, fans and fine-line flowers.",
                 "Carving, relief, fans and gongbi flowers.",
                 "形式", "文化"),
            unit("第三单元 服装、图文与想象 / Unit 3 Costume, Word-and-Image, Imagination",
                 "我设计的服装；图文并茂；宇宙之旅；奥运精神。",
                 "完成服装或图文设计，也可画宇宙/奥运主题。Learning focus: costume, layout, space travel and Olympic spirit.",
                 "Fashion, illustrated text, cosmos and sport.",
                 "创造力", "全球"),
            unit("第四单元 毕业与古建 / Unit 4 Graduation and Ancient Architecture",
                 "二十年后的学校；毕业啦；电子报；我国古代建筑艺术。",
                 "做毕业纪念作品并欣赏古代建筑。Learning focus: a graduation piece and Chinese historic buildings.",
                 "Future school, farewell, e-newspaper and ancient architecture.",
                 "发展", "时空"),
        ],
    },
    7: {
        "Semester 1": [
            unit("第一单元 峥嵘岁月——美术中的历史 / Unit 1 Eventful Years — History in Art",
                 "情感表达；表现形式；创作手法。",
                 "从历史题材作品看情感、形式与手法。Learning focus: how art expresses history through feeling, form and method.",
                 "Emotion, form and technique in historical art.",
                 "视角", "文化"),
            unit("第二单元 时代乐章——线与色的造型 / Unit 2 A Movement of Our Time",
                 "城市名片；科技之光；自然之美。",
                 "用线与色表现城市、科技或自然。Learning focus: city identity, science and nature in line and colour.",
                 "City cards, technology and the beauty of nature.",
                 "时空", "形式"),
            unit("第三单元 运动之美——视觉传达设计 / Unit 3 The Beauty of Sport — Visual Design",
                 "标志设计；吉祥物设计；奖牌设计。",
                 "为运动会设计标志、吉祥物或奖牌。Learning focus: logos, mascots and medals.",
                 "Sports identity: mark, mascot and medal.",
                 "系统", "创造力"),
            unit("第四单元 情境交融——舞台美术设计 / Unit 4 Feeling and Scene — Stage Design",
                 "身临其境；活灵活现。",
                 "为一段情节设计简单舞台或人物造型。Learning focus: immersive space and vivid stage characters.",
                 "Sets, atmosphere and theatrical figure design.",
                 "审美", "交流"),
        ],
        "Semester 2": [
            unit("第一单元 时代赞歌——社会主义建设成就 / Unit 1 An Ode to Our Times",
                 "辉煌成就；生活之美。",
                 "欣赏表现建设成就与生活之美的作品。Learning focus: art of achievement and beauty in daily life.",
                 "National achievements and the beauty of living.",
                 "文化", "社区"),
            unit("第二单元 多彩校园——动态与场景 / Unit 2 A Colourful Campus",
                 "精彩瞬间；律动青春。",
                 "抓住校园运动或课余的动态瞬间。Learning focus: freeze a lively campus moment.",
                 "Action, youth and campus scenes.",
                 "变化", "身份"),
            unit("第三单元 美美与共——校园艺术节设计 / Unit 3 Beauty Shared — Festival Design",
                 "广而告之；盛情邀约。",
                 "为校园艺术节做海报或请柬。Learning focus: posters and invitations for a school arts festival.",
                 "Publicity and invitation design.",
                 "交流", "社区"),
            unit("第四单元 赓续血脉——寻访革命遗址 / Unit 4 Carrying the Torch",
                 "寻访革命遗址；主题创作。",
                 "用速写或设计记录一处红色遗址。Learning focus: visit or study a revolutionary site and make art.",
                 "Heritage sites and continuing the revolutionary spirit.",
                 "时空", "文化"),
        ],
    },
    8: {
        "Semester 1": [
            unit("第一单元 丹青意蕴——中国传统色彩 / Unit 1 The Meaning of Colour in China",
                 "国色之美；国色之韵；国色新尚。",
                 "认识传统色彩并做一次当代应用。Learning focus: traditional Chinese colour, its mood and new uses.",
                 "Classic Chinese colours, rhythm and contemporary fashion.",
                 "文化", "审美"),
            unit("第二单元 可游可居——中国园林艺术 / Unit 2 Gardens to Wander and Dwell In",
                 "因地制宜；精心经营；叠山理水。",
                 "分析一座园林的布局并画示意图。Learning focus: siting, layout, rocks and water in Chinese gardens.",
                 "Site, composition, artificial mountains and water.",
                 "时空", "系统"),
            unit("第三单元 搜尽奇峰——中国山水画艺术 / Unit 3 Seeking Strange Peaks — Landscape Painting",
                 "传移模写；应物象形；气韵生动。",
                 "临摹或写生完成一幅山水小品。Learning focus: copying, depicting from life and qi-yun in landscape.",
                 "Copying masters, drawing from nature and vitality of spirit.",
                 "形式", "审美"),
            unit("第四单元 守正创新——书籍装帧艺术 / Unit 4 Integrity and Innovation — Book Design",
                 "书林漫步；封面设计。",
                 "为喜欢的一本书设计封面。Learning focus: browse book arts and design a cover.",
                 "A walk through books and cover design.",
                 "创造力", "形式"),
        ],
        "Semester 2": [
            unit("第一单元 美术作品的深层意蕴 / Unit 1 Deeper Meaning in Artworks",
                 "情感的抒发与理念的表达；弘扬真善美。",
                 "读懂作品的情感与观念并书面评述。Learning focus: feeling, ideas, truth, goodness and beauty in art.",
                 "Expression of emotion and values in art.",
                 "视角", "审美"),
            unit("第二单元 纹样与生活 / Unit 2 Pattern and Daily Life",
                 "了解纹样；设计纹样。",
                 "为生活用品设计一组纹样。Learning focus: traditional patterns and designing your own.",
                 "Motifs, repeats and pattern for objects.",
                 "形式", "文化"),
            unit("第三单元 为生活增添情趣 / Unit 3 Adding Charm to Life",
                 "插花；摆件巧安排；手工灯饰；装饰画。",
                 "完成一件生活美化物：花、灯或装饰画。Learning focus: flowers, objects, lamps and decorative painting.",
                 "Ikebana/flower, ornaments, lamps and décor.",
                 "审美", "创造力"),
            unit("第四单元 宜居环境与园林 / Unit 4 Liveable Space and Gardens",
                 "和谐温馨的生活空间；装点居室；关注社区；中国古典园林欣赏。",
                 "提出居室或社区的美化方案。Learning focus: interiors, community space and classical gardens.",
                 "Homes, neighbourhoods and garden aesthetics.",
                 "社区", "系统"),
        ],
    },
    9: {
        "Semester 1": [
            unit("第一单元 感受中国古代美术名作 / Unit 1 Masterworks of Ancient China",
                 "独树一帜的中国画；异彩纷呈的古代雕塑、工艺和建筑。",
                 "评述一件中国古代绘画或工艺建筑名作。Learning focus: painting, sculpture, craft and architecture of ancient China.",
                 "Chinese painting, sculpture, craft and buildings.",
                 "文化", "审美"),
            unit("第二单元 情趣浓郁 能工巧匠 / Unit 2 Craft and Ingenious Hands",
                 "剪纸；编结；线材造型；蜡染与扎染；彩塑。",
                 "选一种工艺完成一件作品。Learning focus: paper-cut, knotting, wire, batik/tie-dye and painted clay.",
                 "Folk crafts: cut, knot, dye and clay.",
                 "创造力", "文化"),
            unit("第三单元 土和火的艺术 / Unit 3 Art of Earth and Fire",
                 "陶瓷工艺与欣赏。",
                 "了解陶与瓷的区别并欣赏名窑。Learning focus: pottery and porcelain as earth-and-fire art.",
                 "Ceramics, kilns and the beauty of glaze.",
                 "形式", "系统"),
            unit("第四单元 古城镇与民间美术 / Unit 4 Old Towns and Folk Art",
                 "古城古镇考察；民俗文化；民间美术种类、功能与少数民族美术。",
                 "考察或研究一处古镇/一种民间美术。Learning focus: old towns, folk art types and ethnic visual culture.",
                 "Historic towns, folk functions and minority art.",
                 "时空", "社区"),
        ],
        "Semester 2": [
            unit("第一单元 外国美术名作巡礼 / Unit 1 A Tour of World Masterworks",
                 "丰富多彩的亚非拉美作品；各具特色的欧美美术作品。",
                 "比较不同地区名作的主题与形式。Learning focus: art from Asia, Africa, Latin America, Europe and North America.",
                 "World painting and sculpture, region by region.",
                 "全球", "视角"),
            unit("第二单元 保护世界遗产 / Unit 2 Protecting World Heritage",
                 "世界遗产中的美术与建筑。",
                 "为一项遗产设计保护宣传。Learning focus: heritage sites and how art can help protect them.",
                 "World Heritage and visual advocacy.",
                 "全球", "社区"),
            unit("第三单元 动漫艺术 / Unit 3 Animation and Comics",
                 "形式和内容丰富的动漫；形象设计；动画作品设计制作。",
                 "设计形象并完成短小分镜或动画。Learning focus: comic/anime form, character design and a short animation.",
                 "Comics, characters and making a short moving image.",
                 "创造力", "形式"),
            unit("第四单元 20 世纪中国美术与毕业寄情 / Unit 4 20th-Century Chinese Art and Farewell",
                 "20 世纪中国美术巡礼；留下眷恋，带走真情。",
                 "评述一位现代中国美术家，并做毕业纪念作品。Learning focus: modern Chinese art and a farewell piece.",
                 "Modern masters and taking true feeling with us.",
                 "发展", "身份"),
        ],
    },
}


def weekly_for(grade: int, weekly: dict) -> float:
    if grade == 9:
        v = weekly.get("g10", weekly.get("g9"))
    else:
        v = weekly.get(f"g{grade}")
    if v is None:
        raise RuntimeError(f"no weekly periods for G{grade} in {weekly}")
    return float(v)


def build_units(grade: int, semester: str, raw: list[dict], prefix: str, weekly: dict) -> list[dict]:
    weeks = split_weeks(len(raw))
    wp = weekly_for(grade, weekly)
    stamp = f"{prefix}-g{grade}-{'s1' if semester.endswith('1') else 's2'}"
    out = []
    for i, item in enumerate(raw):
        w = weeks[i]
        periods = wp * week_span(w)
        if abs(periods - round(periods)) < 1e-9:
            periods = int(round(periods))
        out.append({
            "id": f"unit-{stamp}-{i}",
            "title": item["title"],
            "focus": item["focus"],
            "keyConcepts": item["keyConcepts"],
            "week": w,
            "periods": periods,
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


def list_courses(token: str) -> list[dict]:
    raw = request_json("GET", f"{API}/courses", token=token)
    return raw if isinstance(raw, list) else raw.get("courses", [])


def find_course(courses: list[dict], name: str) -> dict:
    hits = [c for c in courses if isinstance(c, dict) and str(c.get("name", "")).strip() == name]
    if not hits:
        names = [str(c.get("name", "")) for c in courses if isinstance(c, dict)]
        raise RuntimeError(f"course not found: {name!r}; available: {names}")
    return hits[0]


def update_course(token: str, course: dict, *, textbook: str,
                  grades: list[str] | None = None, weekly: dict | None = None) -> dict:
    payload = {
        "name": course["name"],
        "subjectCategory": course.get("subjectCategory"),
        "applicableGrades": grades if grades is not None else (course.get("applicableGrades") or []),
        "weeklyPeriodsByGrade": weekly if weekly is not None else (course.get("weeklyPeriodsByGrade") or {}),
        "textbookVersion": textbook,
        "color": course.get("color"),
        "coTeaching": bool(course.get("coTeaching")),
        "excludeFromStaffing": bool(course.get("excludeFromStaffing")),
    }
    cid = str(course["id"])
    saved = request_json("PUT", f"{API}/courses/{cid}", token=token, payload=payload)
    extra = f" grades={payload['applicableGrades']}" if grades is not None else ""
    print(f"Updated {course['name']} textbook={textbook}{extra} id={cid}")
    merged = dict(course)
    if isinstance(saved, dict):
        merged.update(saved)
    merged["id"] = cid
    merged["applicableGrades"] = (
        (saved or {}).get("applicableGrades")
        or payload["applicableGrades"]
        or []
    )
    merged["weeklyPeriodsByGrade"] = (
        (saved or {}).get("weeklyPeriodsByGrade")
        or payload["weeklyPeriodsByGrade"]
        or {}
    )
    return merged


def save_course(token: str, course: dict, catalog: dict[int, dict[str, list[dict]]],
                prefix: str, grades: list[int]) -> tuple[int, list]:
    course_id = str(course["id"])
    weekly = course.get("weeklyPeriodsByGrade") or {}
    ok, fail = 0, []
    for grade in grades:
        for semester in ("Semester 1", "Semester 2"):
            raw = catalog[grade][semester]
            units = build_units(grade, semester, raw, prefix, weekly)
            payload = {"courseId": course_id, "grade": grade, "semester": semester, "units": units}
            label = f"{prefix} G{grade} {semester}"
            try:
                saved = request_json("POST", f"{API}/semester", token=token, payload=payload)
                n = len(saved.get("units") or [])
                titles = " / ".join(u["title"].split(" / ")[0] for u in units)
                print(f"OK  {label}: {n} units | {titles}")
                ok += 1
            except Exception as e:
                print(f"FAIL {label}: {e}", file=sys.stderr)
                fail.append((label, str(e)))
    return ok, fail


def verify(token: str, course: dict, catalog: dict[int, dict[str, list[dict]]], grades: list[int]) -> bool:
    course_id = str(course["id"])
    good = True
    for grade in grades:
        for semester in ("Semester 1", "Semester 2"):
            url = f"{API}/semester/{course_id}/{grade}/{urllib.parse.quote(semester)}"
            data = request_json("GET", url, token=token)
            n = len(data.get("units") or [])
            expect = len(catalog[grade][semester])
            if n != expect:
                print(f"VERIFY FAIL {course.get('name')} G{grade} {semester}: got {n}, expect {expect}", file=sys.stderr)
                good = False
    return good


def main() -> int:
    token = login()
    courses = list_courses(token)

    music = update_course(
        token, find_course(courses, MUSIC_NAME),
        textbook="人教版（2024）",
        grades=G1_9,
        weekly={"g1": 1, "g2": 1, "g3": 2, "g4": 2, "g5": 1, "g6": 1, "g7": 1, "g8": 1, "g10": 1},
    )
    art = update_course(
        token, find_course(courses, ART_NAME),
        textbook="人教版（2024）",
        grades=G1_9,
        weekly={"g1": 2, "g2": 2, "g3": 1, "g4": 1, "g5": 1, "g6": 1, "g7": 1, "g8": 1, "g10": 1},
    )

    print(f"API {API}")
    print(f"Using {MUSIC_NAME} id={music.get('id')}")
    print(f"Using {ART_NAME} id={art.get('id')}")

    ok1, fail1 = save_course(token, music, MUSIC, "mus", list(range(1, 10)))
    ok2, fail2 = save_course(token, art, ART, "art", list(range(1, 10)))
    fail = fail1 + fail2
    total = ok1 + ok2
    print(f"\nDone: {total}/36 semesters saved, {len(fail)} failed.")
    if fail:
        return 1
    v1 = verify(token, music, MUSIC, list(range(1, 10)))
    v2 = verify(token, art, ART, list(range(1, 10)))
    if not (v1 and v2):
        return 1
    print("Verify: all 36 music and art semesters match catalog unit counts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
