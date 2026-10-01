#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐学期写入英语 G1–G9（不走 curriculum/import 整包覆盖）。

教材分轨：
- G1–G4 → 课程「英语-Super Minds」（Cambridge Super Minds 2nd Ed.：G1=Level 1 … G4=Level 4）
- G5–G6 → 课程「英语-朗文快车Longman Express」（收窄适用年级为 G5/G6）
- G7–G9 → 课程「英语-外研版」（2024 新课标；G7 初一、G8 初二、G9 初三）

周次：16 个教学周（跳过第 9、18 周）。
课时：G1–6 周 5 节，G7–9 周 6 节。标题与学习重点中英对照。
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("SUIS_API_URL", "http://127.0.0.1:8080/api").rstrip("/")
ADMIN_USER = os.environ.get("SUIS_ADMIN_USER", "Admin")
ADMIN_PASS = os.environ.get("SUIS_ADMIN_PASS", "4321")

COURSE_SM_NAME = os.environ.get("SUIS_ENGLISH_SM_COURSE", "英语-Super Minds")
COURSE_LE_NAME = os.environ.get("SUIS_ENGLISH_LE_COURSE", "英语-朗文快车Longman Express")
COURSE_WY_NAME = os.environ.get("SUIS_ENGLISH_WY_COURSE", "英语-外研版")

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
    return 5 if grade <= 6 else 6


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


# G1=Level 1, G2=Level 2, G3=Level 3, G4=Level 4（Super Minds 2nd Edition British English）
SUPER_MINDS: dict[int, dict[str, list[dict]]] = {
    1: {
        "Semester 1": [
            unit("Friends / 朋友",
                 "问候、1–10、颜色；认识 Super Friends。Language: What's your name? How old are you?",
                 "能自我介绍并询问姓名、年龄。Learning focus: greet, give name and age, make friends.",
                 "Greetings, numbers 1–10 and colours.",
                 "交流", "关系"),
            unit("1 At school / 在学校",
                 "教室物品；一般疑问与祈使句。Vocabulary: classroom objects. Language: questions and short answers; imperatives.",
                 "能听从课堂指令并用简短答语交流。Learning focus: follow classroom instructions and answer yes/no questions.",
                 "Classroom language, questions and imperatives.",
                 "交流", "系统"),
            unit("2 Let's play / 一起来玩",
                 "玩具与外貌形容词。Vocabulary: toys. Language: What's his / her …? How old is he / she?",
                 "能描述玩具并用 his/her 谈论他人。Learning focus: describe toys and talk about other children.",
                 "Toys, adjectives and possessives.",
                 "形式", "审美"),
            unit("3 Pet show / 宠物秀",
                 "动物与介词 in/on/under；I like / I don't like。Vocabulary: animals.",
                 "能说出动物位置并表达喜好。Learning focus: locate animals with prepositions and express likes.",
                 "Animals, prepositions and likes.",
                 "关系", "社区"),
            unit("4 Lunchtime / 午餐时间",
                 "食物与拥有。Vocabulary: food. Language: I've got / I haven't got; Have … got any …?",
                 "能用 have got 谈论食物并询问有没有。Learning focus: talk about food with have got.",
                 "Food and have got.",
                 "交流", "关联"),
        ],
        "Semester 2": [
            unit("5 Free time / 闲暇时光",
                 "星期与课余活动。Vocabulary: days of the week. Language: I (watch TV) on (Sundays). Do you …?",
                 "能按星期谈论日常爱好并作简短问答。Learning focus: talk about free-time routines by day.",
                 "Days of the week and free-time activities.",
                 "时空", "身份"),
            unit("6 The old house / 老房子",
                 "家居场所。Vocabulary: the home. Language: There's / There are; How many …?",
                 "能用 there is/are 描述房间里有什么。Learning focus: describe a house with there is/are.",
                 "Homes and there is/are.",
                 "形式", "时空"),
            unit("7 Get dressed / 穿好衣服",
                 "服装与喜好；进行时。Vocabulary: clothes. Language: Do you like this / these …? Is he / she + -ing?",
                 "能询问衣服喜好并描述正在做的动作。Learning focus: talk about clothes and present continuous.",
                 "Clothes, this/these and present continuous.",
                 "审美", "交流"),
            unit("8 The robot / 机器人",
                 "身体与能力。Vocabulary: the body. Language: can / can't for ability.",
                 "能用 can/can't 谈论身体动作与能力。Learning focus: say what you can and can't do.",
                 "Body movements and can/can't.",
                 "发展", "逻辑"),
            unit("9 At the beach / 在海滩",
                 "假期与地点。Vocabulary: holidays. Language: suggestions; Where's / Where are …?",
                 "能提出度假建议并询问位置。Learning focus: make holiday suggestions and ask where things are.",
                 "Holidays, suggestions and locations.",
                 "时空", "全球"),
        ],
    },
    2: {
        "Semester 1": [
            unit("Back to school / 回到学校",
                 "教室复习；There's a / There are some；祈使句与互助。",
                 "能描述教室并用祈使句给出简单指令。Learning focus: revise classroom language and help others.",
                 "Classroom revision, there is/are and imperatives.",
                 "社区", "交流"),
            unit("1 My day / 我的一天",
                 "日常作息与整点时间。Vocabulary: daily routines. Language: telling the time; present simple 3rd person.",
                 "能说出整点时间并用第三人称描述作息。Learning focus: tell the time and describe daily routines.",
                 "Daily routines and telling the time.",
                 "时空", "系统"),
            unit("2 The zoo / 动物园",
                 "动物与喜好。Vocabulary: animals. Language: likes / doesn't like; Does … like?",
                 "能询问并描述他人对动物的喜好。Learning focus: talk about animals and third-person likes.",
                 "Animals and Does … like?",
                 "关联", "视角"),
            unit("3 Where we live / 我们住的地方",
                 "城镇场所与位置。Vocabulary: places in a town. Language: Has … got …?; prepositions.",
                 "能询问城镇设施并用介词描述位置。Learning focus: describe a town with have got and prepositions.",
                 "Places in town, have got and prepositions.",
                 "时空", "社区"),
            unit("4 The market / 市场",
                 "食物与购物用语。Vocabulary: food. Language: Would you like …?; some / any.",
                 "能用 some/any 和 Would you like 进行简单购物对话。Learning focus: shop for food with some/any.",
                 "Food, some/any and Would you like.",
                 "交流", "文化"),
        ],
        "Semester 2": [
            unit("5 My bedroom / 我的卧室",
                 "家具与指示代词。Vocabulary: furniture. Language: this/that/these/those; Whose …?",
                 "能描述卧室物品并询问所属。Learning focus: describe furniture and ask whose it is.",
                 "Furniture, demonstratives and whose.",
                 "形式", "关系"),
            unit("6 People / 人们",
                 "五官与外貌；月份。Vocabulary: the face. Language: be + adjective; our / their.",
                 "能描述外貌并说出月份。Learning focus: describe faces and use possessive adjectives.",
                 "Faces, adjectives and months.",
                 "身份", "审美"),
            unit("7 Off we go! / 出发吧",
                 "交通工具。Vocabulary: transport. Language: I'd like to …; verb + -ing.",
                 "能谈论交通方式并表达想去的地方。Learning focus: talk about transport and I'd like to.",
                 "Transport and I'd like to.",
                 "全球", "时空"),
            unit("8 Sports club / 体育俱乐部",
                 "运动项目。Vocabulary: sport. Language: like + -ing.",
                 "能用 like + -ing 谈论喜爱的运动并邀请他人加入。Learning focus: talk about sports with like + -ing.",
                 "Sports and like + -ing.",
                 "社区", "发展"),
            unit("9 Holiday plans / 假期计划",
                 "假期活动；can 表示请求。Vocabulary: holidays.",
                 "能规划简单假期并用 can 提出请求。Learning focus: plan a holiday and make requests with can.",
                 "Holiday plans and can for requests.",
                 "创造力", "关系"),
        ],
    },
    3: {
        "Semester 1": [
            unit("Meet The Explorers / 认识探险家",
                 "数字复习；be good at + ing；所有格。Value: courage.",
                 "能谈论擅长的活动并理解所有格。Learning focus: say what you are good at and use possessives.",
                 "Be good at + -ing and possessive apostrophe.",
                 "身份", "发展"),
            unit("1 Our school / 我们的学校",
                 "学科与喜好；必须做的事。Vocabulary: school subjects. Language: like / don't like + -ing; have to.",
                 "能谈论学科喜好并用 have to 说校规。Learning focus: talk about subjects and obligations at school.",
                 "School subjects, like + -ing and have to.",
                 "系统", "社区"),
            unit("2 The picnic / 野餐",
                 "食物与建议。Vocabulary: food. Language: some / any; suggestions.",
                 "能用 some/any 讨论野餐食物并提出建议。Learning focus: plan picnic food and make suggestions.",
                 "Picnic food, some/any and suggestions.",
                 "交流", "关联"),
            unit("3 Daily tasks / 日常事务",
                 "家务与时间副词。Vocabulary: daily tasks. Language: telling the time; adverbs of time.",
                 "能按时间顺序描述家务与日常任务。Learning focus: describe chores and tell the time.",
                 "Daily tasks, time and adverbs.",
                 "时空", "关系"),
            unit("4 Around town / 城镇四处",
                 "城镇设施与目的。Vocabulary: towns. Language: prepositions; be going to + infinitive of purpose.",
                 "能指路并用 going to 说明去某处的目的。Learning focus: talk about town places and purpose.",
                 "Towns, prepositions and going to for purpose.",
                 "时空", "社区"),
        ],
        "Semester 2": [
            unit("5 Under the sea / 海底世界",
                 "海洋生物。Vocabulary: sea creatures. Language: was / were.",
                 "能用 was/were 描述过去在海里看到什么。Learning focus: talk about sea life in the past with was/were.",
                 "Sea creatures and was/were.",
                 "关联", "变化"),
            unit("6 Gadgets / 小发明",
                 "科技用品。Vocabulary: technology. Language: comparatives and superlatives.",
                 "能用比较级、最高级比较小发明的功能。Learning focus: compare gadgets with -er/-est.",
                 "Technology, comparatives and superlatives.",
                 "创造力", "形式"),
            unit("7 In the hospital / 在医院",
                 "健康与就医。Vocabulary: health. Language: past simple regular and irregular.",
                 "能用一般过去时讲述看病或保持健康的经历。Learning focus: tell a health story in the past simple.",
                 "Health and past simple.",
                 "发展", "系统"),
            unit("8 Around the world / 环游世界",
                 "国家与世界奇观。Vocabulary: countries. Language: past simple negatives and questions.",
                 "能用过去时问答旅行经历并关注其他文化。Learning focus: ask and answer about travel in the past.",
                 "Countries and past simple questions/negatives.",
                 "全球", "文化"),
            unit("9 Holiday plans / 假期计划",
                 "天气与将来计划。Vocabulary: weather. Language: be going to.",
                 "能用 going to 规划假期并谈论天气。Learning focus: plan holidays with be going to.",
                 "Weather and future with be going to.",
                 "时空", "创造力"),
        ],
    },
    4: {
        "Semester 1": [
            unit("Well done, Ben and Lucy! / 好样的，Ben 和 Lucy",
                 "城镇活动复习；一般现在/过去疑问。Vocabulary: at town events. Language: present and past simple questions.",
                 "能用现在时和过去时提问并复习探险故事。Learning focus: revise questions in present and past simple.",
                 "Town events and question forms.",
                 "交流", "身份"),
            unit("1 In the museum / 在博物馆",
                 "骑士与女王、时间线。Vocabulary: knights and queens. Language: must / mustn't; direct and indirect objects.",
                 "能用 must/mustn't 谈论规则并从博物馆学习过去。Learning focus: learn about the past with must/mustn't.",
                 "Museums, knights and queens, must/mustn't.",
                 "文化", "时空"),
            unit("2 The world around us / 我们周围的世界",
                 "乡村与户外。Vocabulary: the countryside. Language: past simple revision; could / couldn't; connectors.",
                 "能用过去时和 could 描述户外经历。Learning focus: talk about the outside world in the past.",
                 "Countryside, past simple and could/couldn't.",
                 "全球", "关联"),
            unit("3 Danger! / 危险！",
                 "紧急情况与水的危险。Vocabulary: emergencies. Language: past continuous and questions.",
                 "能用过去进行时描述紧急情景。Learning focus: narrate emergencies with the past continuous.",
                 "Emergencies, floods and past continuous.",
                 "变化", "系统"),
            unit("4 Two return tickets / 两张往返票",
                 "火车站与出行方式。Vocabulary: at the train station. Language: at/in/on; past continuous and past simple.",
                 "能比较出行方式并用过去时讲旅行故事。Learning focus: talk about travel and mix past tenses.",
                 "Train travel, prepositions and past tenses.",
                 "时空", "全球"),
        ],
        "Semester 2": [
            unit("5 Police! / 警察！",
                 "外貌描写。Vocabulary: hair and face. Language: used to; had to.",
                 "能用 used to / had to 描述外貌与过去习惯。Learning focus: describe people with used to and had to.",
                 "Describing people; used to and had to.",
                 "身份", "形式"),
            unit("6 Mythical beasts / 神话野兽",
                 "动物身体与恐龙。Vocabulary: animal bodies. Language: comparatives and superlatives; It looks like …",
                 "能比较动物特征并用 It looks like 描述。Learning focus: compare creatures and say what they look like.",
                 "Mythical beasts, dinosaurs and comparisons.",
                 "创造力", "审美"),
            unit("7 Orchestra practice / 乐团练习",
                 "乐器与音乐。Vocabulary: musical instruments. Language: possessive pronouns; who / which / where.",
                 "能谈论乐器并用关系代词描述。Learning focus: talk about instruments with who/which/where.",
                 "Instruments, teamwork and relative pronouns.",
                 "审美", "关系"),
            unit("8 In the planetarium / 在天文馆",
                 "太空。Vocabulary: space. Language: will; adverbs.",
                 "能用 will 谈论太空与未来。Learning focus: talk about space with will and adverbs.",
                 "Space, will and adverbs.",
                 "全球", "发展"),
            unit("9 At the campsite / 在营地",
                 "假期活动与量词。Vocabulary: holiday activities. Language: a bottle/can/loaf of; How much / How many.",
                 "能规划露营并用 How much/many 谈论数量。Learning focus: camping plans and quantity phrases.",
                 "Camping, quantities and holiday plans.",
                 "时空", "系统"),
        ],
    },
}

# Primary Longman Express：每册 6 章；A=上学期，B=下学期
LONGMAN: dict[int, dict[str, list[dict]]] = {
    5: {
        "Semester 1": [
            unit("Ch 1 Behave yourselves / 懂礼貌",
                 "课堂与社交礼仪；不同文化中的肢体语言、做客与餐桌礼仪。Language: should / shouldn't.",
                 "能用 should/shouldn't 给出礼貌建议，尊重文化差异。Learning focus: give advice on manners with should/shouldn't.",
                 "Good manners across cultures; should/shouldn't.",
                 "文化", "交流"),
            unit("Ch 2 Getting along / 与人相处",
                 "朋友与家人相处：share with, laugh at, get on well。Language: hope … will …",
                 "能描述人际关系并用 hope 表达愿望。Learning focus: talk about relationships and hopes.",
                 "Friendship, family and getting along.",
                 "关系", "身份"),
            unit("Ch 3 Amazing people / 了不起的人",
                 "用 who 定语从句描述人物特长与活动。Language: who-clauses.",
                 "能用 who 从句介绍人物特点。Learning focus: describe people with relative clauses (who).",
                 "Describing people with who.",
                 "身份", "形式"),
            unit("Ch 4 Our belongings / 我们的物品",
                 "物品所属。Language: whose; possessive pronouns (mine, yours, his, hers, ours, theirs).",
                 "能询问并说明物品属于谁。Learning focus: ask whose and use possessive pronouns.",
                 "Whose and possessive pronouns.",
                 "关系", "逻辑"),
            unit("Ch 5 Have you ever…? / 你曾经……吗",
                 "生活经历。Language: present perfect; irregular past participles.",
                 "能用现在完成时谈论做过的事。Learning focus: talk about experiences with the present perfect.",
                 "Life experiences and present perfect.",
                 "变化", "发展"),
            unit("Ch 6 Fun in Hong Kong / 香港乐事",
                 "香港景点与活动频次。Language: present perfect + how many times; past simple for exact time.",
                 "能区分完成时谈次数与过去时谈具体时间。Learning focus: talk about visits to HK places with how many times.",
                 "Hong Kong places, frequency and present perfect.",
                 "时空", "社区"),
        ],
        "Semester 2": [
            unit("Ch 1 Helping out / 伸出援手",
                 "在家与社区帮忙。Language: should; need to; offers with I'll / Shall I …?",
                 "能提出帮助并说明应做的家务。Learning focus: offer help and talk about chores.",
                 "Helping at home and in the community.",
                 "社区", "关系"),
            unit("Ch 2 A healthy life / 健康生活",
                 "饮食、运动与作息。Language: too / enough; advice with should.",
                 "能评价生活习惯并给出健康建议。Learning focus: talk about healthy habits with too/enough.",
                 "Healthy eating, exercise and advice.",
                 "发展", "系统"),
            unit("Ch 3 How to make it / 动手做",
                 "食谱与步骤说明。Language: imperatives; sequencing (first, then, next, finally).",
                 "能读、写简单步骤说明。Learning focus: follow and write instructions in order.",
                 "Recipes, instructions and sequencing.",
                 "逻辑", "创造力"),
            unit("Ch 4 What were you doing? / 你当时在做什么",
                 "意外与同时发生的动作。Language: past continuous; when / while.",
                 "能用过去进行时讲述当时正在发生的事。Learning focus: narrate events with the past continuous.",
                 "Accidents and past continuous.",
                 "变化", "时空"),
            unit("Ch 5 Animals in danger / 濒危动物",
                 "野生动物保护。Language: because / so; we should / we must.",
                 "能说明动物濒危原因并提出保护建议。Learning focus: explain why animals are in danger and how to help.",
                 "Endangered animals and conservation.",
                 "全球", "关联"),
            unit("Ch 6 Festivals around us / 身边的节日",
                 "中外节日习俗。Language: present simple for customs; prepositions of time.",
                 "能介绍节日活动并比较文化习俗。Learning focus: describe festival customs and compare cultures.",
                 "Festivals, customs and culture.",
                 "文化", "视角"),
        ],
    },
    6: {
        "Semester 1": [
            unit("Ch 1 When I grow up / 我长大以后",
                 "理想职业。Language: want to be; will / won't; future plans.",
                 "能谈论理想工作并说明理由。Learning focus: talk about dream jobs with will.",
                 "Dream jobs and future will.",
                 "身份", "发展"),
            unit("Ch 2 If I become… / 如果我成为……",
                 "职业假设与条件。Language: first conditional (If I become …, I will …).",
                 "能用真实条件句谈论职业选择的结果。Learning focus: use the first conditional for career ideas.",
                 "First conditional and future careers.",
                 "逻辑", "创造力"),
            unit("Ch 3 Save our planet / 拯救地球",
                 "环境问题与行动。Language: if …, we will/won't; we should / must.",
                 "能描述环境问题并提议行动。Learning focus: discuss environmental problems and solutions.",
                 "Environment and taking action.",
                 "全球", "系统"),
            unit("Ch 4 Then and now / 今昔对比",
                 "生活变化。Language: used to; comparatives; past vs present.",
                 "能对比过去与现在的生活。Learning focus: compare life then and now with used to.",
                 "Life in the past and present.",
                 "变化", "时空"),
            unit("Ch 5 In the news / 新闻报道",
                 "新闻体裁与客观叙述。Language: reported facts; passive (is used / was built) where useful.",
                 "能读简单新闻并写出短讯。Learning focus: read and write a simple news report.",
                 "News reports and factual writing.",
                 "交流", "视角"),
            unit("Ch 6 Special days / 特别的日子",
                 "庆典、纪念与邀请。Language: invitations; present perfect for recent events.",
                 "能写邀请或介绍特别日子。Learning focus: write about special days and invitations.",
                 "Celebrations, invitations and special days.",
                 "文化", "关系"),
        ],
        "Semester 2": [
            unit("Ch 1 Giving advice / 给出建议",
                 "同伴问题与建议。Language: should / had better / why don't you; if I were you.",
                 "能针对问题给出得体建议。Learning focus: give advice on common problems.",
                 "Advice language for everyday problems.",
                 "交流", "关系"),
            unit("Ch 2 Telling a story / 讲故事",
                 "故事地图：背景、问题、经过、结局。Language: past simple and past continuous; time connectors.",
                 "能按故事结构口头/书面讲述。Learning focus: plan and write a story with a story map.",
                 "Narrative structure and past tenses.",
                 "创造力", "形式"),
            unit("Ch 3 Changes in our lives / 生活中的变化",
                 "成长与校园变化。Language: present perfect with already / yet / just; comparatives.",
                 "能描述自己的成长变化。Learning focus: talk about personal change with the present perfect.",
                 "Personal growth and change.",
                 "变化", "身份"),
            unit("Ch 4 Getting ready for secondary / 迎接中学",
                 "中学学习与新环境。Language: will; first conditional; need to.",
                 "能谈论升中准备与期待。Learning focus: talk about moving on to secondary school.",
                 "Secondary school and future preparation.",
                 "发展", "系统"),
            unit("Ch 5 We can make a difference / 我们可以有所作为",
                 "社区服务与小行动。Language: we can / could; let's; suggestions.",
                 "能策划一项帮助他人或环境的小行动。Learning focus: plan a community or green action.",
                 "Community action and making a difference.",
                 "社区", "全球"),
            unit("Ch 6 Looking ahead / 展望未来",
                 "学年回顾与暑期/未来计划。Language: be going to; will; review of key tenses.",
                 "能总结本学年并用将来时谈计划。Learning focus: review the year and talk about future plans.",
                 "Year review and looking ahead.",
                 "视角", "发展"),
        ],
    },
}

# 外研版 2024 新课标（七上 Starter+U1–6；其余每册 6 单元）。
# 九下 2024 Unit 目录尚未公布，按现行外研九下 Module 合并为 6 个教学单元。
WAIYAN: dict[int, dict[str, list[dict]]] = {
    7: {
        "Semester 1": [
            unit("Starter Welcome to junior high! / 欢迎来到初中",
                 "初中校园生活、课程与作息；问候与课堂用语。",
                 "能适应初中英语课堂，用英语介绍学校一天。Learning focus: settle into junior high and use classroom English.",
                 "Starting junior high: school life and classroom language.",
                 "社区", "身份"),
            unit("Unit 1 A new start / 新的开始",
                 "新同学、新老师与新学期目标。Language: be; present simple for introductions.",
                 "能介绍自己和新学校生活。Learning focus: introduce yourself and talk about a new start.",
                 "A new start at school; introductions.",
                 "身份", "发展"),
            unit("Unit 2 More than fun / 不止是玩",
                 "兴趣活动与有意义的课余生活。Language: like / enjoy + -ing; adverbs of frequency.",
                 "能谈论爱好并说明其意义。Learning focus: talk about hobbies that are more than fun.",
                 "Hobbies, clubs and meaningful free time.",
                 "身份", "创造力"),
            unit("Unit 3 Family ties / 家庭纽带",
                 "家庭关系、家务与亲情。Language: present simple; possessive 's.",
                 "能描述家庭成员及彼此支持。Learning focus: describe family ties and home life.",
                 "Family relationships and home life.",
                 "关系", "文化"),
            unit("Unit 4 Time to celebrate / 庆祝时光",
                 "中外节日与庆祝方式。Language: present simple for customs; prepositions of time.",
                 "能介绍节日活动并比较文化。Learning focus: talk about festivals and celebrations.",
                 "Festivals and ways of celebrating.",
                 "文化", "全球"),
            unit("Unit 5 The power of plants / 植物的力量",
                 "植物、自然与人类生活。Language: there be; can for possibility.",
                 "能说明植物的作用并表达保护自然。Learning focus: talk about plants and why they matter.",
                 "Plants, nature and our lives.",
                 "关联", "系统"),
            unit("Unit 6 Fantastic friends / 奇妙的朋友",
                 "友谊、动物伙伴与互助。Language: adjectives; present continuous for current actions.",
                 "能描述朋友特点并讲述相处经历。Learning focus: describe friends and friendship.",
                 "Friendship with people and animals.",
                 "关系", "视角"),
        ],
        "Semester 2": [
            unit("Unit 1 The secrets of happiness / 幸福的秘诀",
                 "幸福观：爱、家庭与积极心态。Language: because / so; linking ideas.",
                 "能讨论什么带来幸福并说明理由。Learning focus: talk about sources of happiness.",
                 "What happiness means and how we find it.",
                 "视角", "关系"),
            unit("Unit 2 Go for it! / 加油！",
                 "运动与体育精神。Language: imperatives; can / can't; adverbs.",
                 "能谈论运动项目并表达努力与坚持。Learning focus: talk about sports and trying hard.",
                 "Sports, effort and sportsmanship.",
                 "发展", "身份"),
            unit("Unit 3 Food matters / 食物很重要",
                 "食物与健康、情感和文化。Language: countable/uncountable; some/any; like/prefer.",
                 "能讨论饮食选择及其影响。Learning focus: talk about food, health and culture.",
                 "Food, health, feelings and culture.",
                 "文化", "关联"),
            unit("Unit 4 The art of having fun / 玩乐的艺术",
                 "学习与休闲的平衡。Language: how often; suggestions (Let's / Why not).",
                 "能规划有意义的课余生活。Learning focus: balance study and fun.",
                 "Leisure, balance and enjoying life.",
                 "身份", "系统"),
            unit("Unit 5 Amazing nature / 神奇的自然",
                 "自然奇观与保护。Language: adjectives; there be; should for advice.",
                 "能描述自然景观并倡议保护。Learning focus: describe nature and how to protect it.",
                 "Amazing nature and conservation.",
                 "全球", "审美"),
            unit("Unit 6 Hitting the road / 出发上路",
                 "旅行计划、交通与见闻。Language: be going to; prepositions of place/movement.",
                 "能规划短途旅行并描述行程。Learning focus: plan a trip and talk about travel.",
                 "Travel plans and hitting the road.",
                 "时空", "全球"),
        ],
    },
    8: {
        "Semester 1": [
            unit("Unit 1 This is me / 这就是我",
                 "外貌、性格、兴趣与成长变化。Language: present perfect for change; used to.",
                 "能介绍现在的自己并对比过去。Learning focus: describe who you are and how you have changed.",
                 "Identity, personality and growing up.",
                 "身份", "变化"),
            unit("Unit 2 Getting along / 与人相处",
                 "同伴关系、冲突与和解。Language: should; if-clauses for advice.",
                 "能讨论相处问题并给出建议。Learning focus: talk about friendship problems and solutions.",
                 "Getting along with others.",
                 "关系", "交流"),
            unit("Unit 3 Make it happen! / 让它发生",
                 "目标、坚持与把想法变成行动。Language: be going to / will; infinitives of purpose.",
                 "能设定目标并说明如何实现。Learning focus: set goals and talk about making them happen.",
                 "Goals, effort and making ideas happen.",
                 "发展", "创造力"),
            unit("Unit 4 Digital life / 数字生活",
                 "屏幕时间、网络礼仪与数字冲击。Language: comparatives; advice; present perfect.",
                 "能讨论数字生活利弊并提出合理使用建议。Learning focus: discuss digital life and healthy screen habits.",
                 "Digital life, online habits and balance.",
                 "系统", "视角"),
            unit("Unit 5 Play by the rules? / 按规则行事？",
                 "校规、社会规则与公平。Language: must / have to / should; if we break rules …",
                 "能讨论规则的意义并表达观点。Learning focus: talk about rules and whether we should always follow them.",
                 "Rules, fairness and responsibility.",
                 "社区", "逻辑"),
            unit("Unit 6 When disaster strikes / 当灾难来临",
                 "自然灾害与互助。Language: past simple / past continuous; we should …",
                 "能描述灾害情景并讨论如何准备与互助。Learning focus: talk about disasters and helping people in danger.",
                 "Natural disasters and helping others.",
                 "全球", "关系"),
        ],
        "Semester 2": [
            unit("Unit 1 Career talks / 职业访谈",
                 "职业探索、兴趣与能力。Language: want to / would like to; because.",
                 "能介绍职业并说明自己的兴趣方向。Learning focus: explore careers and talk about future work.",
                 "Jobs, skills and career talks.",
                 "发展", "身份"),
            unit("Unit 2 Growing pains and gains / 成长的烦恼与收获",
                 "青春期压力、同伴与家庭沟通。Language: present perfect; linking words.",
                 "能描述成长烦恼并讨论如何面对。Learning focus: talk about growing pains and what we gain.",
                 "Teenage worries, pressure and growth.",
                 "变化", "关系"),
            unit("Unit 3 What makes a great team? / 怎样才是好团队",
                 "团队合作、角色与体育/项目精神。Language: modals (can/should/must); pronouns.",
                 "能说明好团队的要素并评价合作经历。Learning focus: discuss teamwork and what makes a team great.",
                 "Teamwork and cooperation.",
                 "社区", "系统"),
            unit("Unit 4 Helping out / 伸出援手",
                 "志愿与社区服务。Language: infinitives; suggestions; present perfect for experience.",
                 "能讲述助人经历并倡议行动。Learning focus: talk about volunteering and helping out.",
                 "Volunteering and helping the community.",
                 "社区", "交流"),
            unit("Unit 5 Looking into nature / 探寻自然",
                 "科学观察与自然奥秘。Language: passive where useful; because/so.",
                 "能描述自然现象并表达探究兴趣。Learning focus: explore nature with curiosity.",
                 "Looking into nature and science.",
                 "关联", "视角"),
            unit("Unit 6 Living with nature / 与自然共处",
                 "人与自然和谐、环保行动。Language: conditionals; we should / must.",
                 "能讨论如何与自然共处并制定小行动。Learning focus: discuss living with nature sustainably.",
                 "Living with nature and protecting the environment.",
                 "全球", "系统"),
        ],
    },
    9: {
        "Semester 1": [
            unit("Unit 1 Teenagers today / 今日青少年",
                 "当代青少年的生活、压力与自我认同。Language: present perfect; comparatives.",
                 "能讨论青少年话题并表达自己的立场。Learning focus: talk about teenagers today and identity.",
                 "Teenage life, pressure and who we are.",
                 "身份", "视角"),
            unit("Unit 2 On the money / 关于钱",
                 "金钱观、消费与理财意识。Language: if-clauses; should / had better.",
                 "能讨论花钱与存钱并给出合理建议。Learning focus: talk about money, spending and values.",
                 "Money, spending and making wise choices.",
                 "逻辑", "系统"),
            unit("Unit 3 Past passing by / 逝去的时光",
                 "回忆、历史瞬间与时间流逝。Language: past tenses; used to; time clauses.",
                 "能讲述过去经历并反思变化。Learning focus: narrate the past and reflect on change.",
                 "Memories, history and time passing.",
                 "变化", "时空"),
            unit("Unit 4 Heroes / 英雄",
                 "英雄人物、品质与榜样。Language: relative clauses; because / so that.",
                 "能介绍心中的英雄并说明其品质。Learning focus: describe heroes and what we can learn from them.",
                 "Heroes, qualities and role models.",
                 "身份", "文化"),
            unit("Unit 5 A fine balance / 巧妙的平衡",
                 "学习、生活与身心平衡。Language: although / however; advice language.",
                 "能讨论如何保持生活平衡。Learning focus: talk about balance in study and life.",
                 "Balance among study, rest and wellbeing.",
                 "系统", "发展"),
            unit("Unit 6 Live green / 绿色生活",
                 "低碳生活与可持续发展。Language: conditionals; we can / must; suggestions.",
                 "能提出绿色生活行动并论证必要性。Learning focus: discuss green living and take action.",
                 "Green living and sustainable choices.",
                 "全球", "社区"),
        ],
        "Semester 2": [
            unit("Module 1 Travel / 旅行",
                 "出行方式、旅行经历与见闻（现行外研九下 Module 1）。Language: past simple; by + transport.",
                 "能描述旅行经历并比较交通方式。Learning focus: talk about travel experiences and transport.",
                 "Travel stories and getting around.",
                 "时空", "全球"),
            unit("Module 2 Education / 教育",
                 "学校生活、课堂文化与学习方式。Language: present simple; comparatives.",
                 "能比较不同学校生活并表达喜好。Learning focus: talk about school life and education.",
                 "School life and what we like about education.",
                 "系统", "视角"),
            unit("Module 3 Life now and then / 今昔生活",
                 "生活变化与社会进步。Language: comparatives; used to; past vs present.",
                 "能对比过去与现在的生活并评价变化。Learning focus: compare life now and then.",
                 "How life has changed over time.",
                 "变化", "发展"),
            unit("Module 4 Rules and suggestions / 规则与建议",
                 "安全规则、建议与必须做的事。Language: must / mustn't / had better.",
                 "能提出安全建议并说明规则理由。Learning focus: give rules and suggestions.",
                 "Rules, safety and advice.",
                 "逻辑", "社区"),
            unit("Modules 5–6 Health & eating together / 健康与共餐",
                 "健康习惯、就医建议与餐桌文化（Module 5–6）。Language: had better; passive for customs.",
                 "能讨论健康生活并介绍中西餐礼仪。Learning focus: talk about health and eating together.",
                 "Looking after yourself and table culture.",
                 "文化", "关系"),
            unit("Modules 7–8 English and my future / 英语与未来",
                 "英语的用途、毕业与未来生活（Module 7–8）及中考复习。Language: present perfect; will; review.",
                 "能反思英语学习并规划未来。Learning focus: reflect on English learning and future life.",
                 "English for you and me; friendship and the future.",
                 "发展", "交流"),
        ],
    },
}


def build_units(grade: int, semester: str, raw: list[dict], prefix: str) -> list[dict]:
    weeks = split_weeks(len(raw))
    wp = weekly_periods(grade)
    stamp = f"{prefix}-g{grade}-{'s1' if semester.endswith('1') else 's2'}"
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


def request_json(method: str, url: str, token: str | None = None, payload: dict | None = None):
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


def find_course(courses: list[dict], name: str) -> dict | None:
    hits = [c for c in courses if isinstance(c, dict) and str(c.get("name", "")).strip() == name]
    return hits[0] if hits else None


def upsert_course(token: str, *, name: str, grades: list[str], weekly: dict[str, int],
                  textbook: str, color: str, existing: dict | None) -> str:
    payload = {
        "name": name,
        "subjectCategory": {"zh": "英语", "en": "English"},
        "applicableGrades": grades,
        "weeklyPeriodsByGrade": weekly,
        "textbookVersion": textbook,
        "color": color,
        "coTeaching": bool(existing.get("coTeaching")) if existing else False,
        "excludeFromStaffing": bool(existing.get("excludeFromStaffing")) if existing else False,
    }
    if existing:
        cid = str(existing["id"])
        saved = request_json("PUT", f"{API}/courses/{cid}", token=token, payload=payload)
        print(f"Updated course {name} id={cid} grades={grades}")
        return str(saved.get("id") or cid)
    payload["id"] = f"course-{int(time.time() * 1000)}"
    saved = request_json("POST", f"{API}/courses", token=token, payload=payload)
    cid = str(saved.get("id") or payload["id"])
    print(f"Created course {name} id={cid} grades={grades}")
    return cid


def save_course(token: str, course_id: str, catalog: dict[int, dict[str, list[dict]]], prefix: str, grades: range) -> tuple[int, list]:
    ok, fail = 0, []
    for grade in grades:
        for semester in ("Semester 1", "Semester 2"):
            raw = catalog[grade][semester]
            units = build_units(grade, semester, raw, prefix)
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


def verify(token: str, course_id: str, catalog: dict[int, dict[str, list[dict]]], grades: range) -> bool:
    good = True
    for grade in grades:
        for semester in ("Semester 1", "Semester 2"):
            url = f"{API}/semester/{course_id}/{grade}/{urllib.parse.quote(semester)}"
            data = request_json("GET", url, token=token)
            n = len(data.get("units") or [])
            expect = len(catalog[grade][semester])
            if n != expect:
                print(f"VERIFY FAIL {course_id} G{grade} {semester}: got {n}, expect {expect}", file=sys.stderr)
                good = False
    return good


def main() -> int:
    token = login()
    courses = list_courses(token)
    sm = find_course(courses, COURSE_SM_NAME)
    le = find_course(courses, COURSE_LE_NAME)
    wy = find_course(courses, COURSE_WY_NAME)

    sm_id = upsert_course(
        token, name=COURSE_SM_NAME,
        grades=["g1", "g2", "g3", "g4"],
        weekly={"g1": 5, "g2": 5, "g3": 5, "g4": 5},
        textbook="Cambridge Super Minds (2nd Edition)",
        color="light-blue",
        existing=sm,
    )
    le_id = upsert_course(
        token, name=COURSE_LE_NAME,
        grades=["g5", "g6"],
        weekly={"g5": 5, "g6": 5},
        textbook="朗文快车Longman Express",
        color=(le or {}).get("color") or "light-blue",
        existing=le,
    )
    wy_id = upsert_course(
        token, name=COURSE_WY_NAME,
        grades=["g7", "g8", "g10"],
        weekly={"g7": 6, "g8": 6, "g10": 6},
        textbook="外研版（2024）",
        color="light-blue",
        existing=wy,
    )

    print(f"API {API}")
    print(f"Using {COURSE_SM_NAME} id={sm_id}")
    print(f"Using {COURSE_LE_NAME} id={le_id}")
    print(f"Using {COURSE_WY_NAME} id={wy_id}")

    ok1, fail1 = save_course(token, sm_id, SUPER_MINDS, "sm", range(1, 5))
    ok2, fail2 = save_course(token, le_id, LONGMAN, "le", range(5, 7))
    ok3, fail3 = save_course(token, wy_id, WAIYAN, "wy", range(7, 10))
    fail = fail1 + fail2 + fail3
    total = ok1 + ok2 + ok3
    print(f"\nDone: {total}/18 semesters saved, {len(fail)} failed.")
    if fail:
        return 1
    v1 = verify(token, sm_id, SUPER_MINDS, range(1, 5))
    v2 = verify(token, le_id, LONGMAN, range(5, 7))
    v3 = verify(token, wy_id, WAIYAN, range(7, 10))
    if not (v1 and v2 and v3):
        return 1
    print("Verify: all 18 English semesters match catalog unit counts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
