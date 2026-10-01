#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐学期写入「道法-人教版」G1–G9（统编人教）。
小学以 2024/2025 修订册为主，尚未出新版的年级沿用 2019 部编目录；
初中 G7–G8 用 2024 新课标，G9 仍用现行部编九上/九下。

不走 curriculum/import 整包覆盖。周次：16 个教学周（跳过第 9、18 周）。
课时沿用课程已设周课时：G1–6 为 1，G7–8 为 2，G9 为 3.5。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("SUIS_API_URL", "http://127.0.0.1:8080/api").rstrip("/")
COURSE_NAME = os.environ.get("SUIS_DAOFA_COURSE", "道法-人教版")
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


def weekly_periods(grade: int) -> float:
    if grade <= 6:
        return 1
    if grade <= 8:
        return 2
    return 3.5


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


CATALOG: dict[int, dict[str, list[dict]]] = {
    1: {
        "Semester 1": [
            unit("第一单元 我是小学生啦",
                 "开开心心上学去；我向国旗敬个礼；这是我们的校园；平平安安回家来。",
                 "适应小学生活，认识校园与国旗，养成安全上下学习惯。Learning focus: settle into school and show respect for the national flag.",
                 "Starting Grade 1: campus, flag, and going to school safely.",
                 "身份", "社区"),
            unit("第二单元 过好校园生活",
                 "老师，您好！；拉拉手，交朋友；上课了；课余生活真丰富。",
                 "尊敬老师、结交朋友，了解上课与课余生活。Learning focus: greet teachers, make friends, and enjoy school life.",
                 "Teachers, friends, lessons and playtime.",
                 "关系", "交流"),
            unit("第三单元 养成良好习惯",
                 "作息有规律；吃饭有讲究；对人有礼貌；玩也有学问。",
                 "养成作息、饮食、礼貌与安全游戏的好习惯。Learning focus: build daily routines, manners and safe play.",
                 "Routines, meals, manners and play.",
                 "发展", "系统"),
            unit("第四单元 我们讲文明",
                 "我们小点儿声；人人爱护公物；我们不乱扔；大家排好队。",
                 "在公共场合轻声、爱护公物、不乱扔、排队。Learning focus: practise public manners at school.",
                 "Quiet voices, public property, no littering, lining up.",
                 "社区", "文化"),
        ],
        "Semester 2": [
            unit("第一单元 我的好习惯",
                 "我们爱整洁；我们有精神；我不拖拉；不做“小马虎”。",
                 "养成整洁、精神饱满、不拖拉、认真做事的习惯。Learning focus: be tidy, energetic, punctual and careful.",
                 "Personal habits: tidy, energetic, on time, careful.",
                 "发展", "身份"),
            unit("第二单元 我和大自然",
                 "风儿轻轻吹；花儿草儿真美丽；可爱的动物；大自然，谢谢您。",
                 "亲近自然，爱护花草动物。Learning focus: notice nature and say thank you to it.",
                 "Wind, plants, animals and gratitude to nature.",
                 "关联", "审美"),
            unit("第三单元 我爱我家",
                 "我和我的家；家人的爱；让我自己来整理；干点家务活。",
                 "感受家人关爱，学做力所能及的家务。Learning focus: feel family love and help at home.",
                 "Family love, packing up and simple chores.",
                 "关系", "社区"),
            unit("第四单元 我们在一起",
                 "我想和你们一起玩；请帮我一下吧；分享真快乐；大家一起来；我们都是少先队员。",
                 "学会合作、求助、分享，认识少先队。Learning focus: play together, ask for help, share, and join the Young Pioneers.",
                 "Playing together, sharing and Young Pioneers.",
                 "关系", "社区"),
        ],
    },
    2: {
        "Semester 1": [
            unit("第一单元 我们的节假日",
                 "假期有收获；周末巧安排；欢欢喜喜庆国庆；团团圆圆过中秋。",
                 "合理安排假期，了解国庆与中秋。Learning focus: plan holidays and celebrate National Day and Mid-Autumn.",
                 "Holidays, National Day and Mid-Autumn Festival.",
                 "文化", "时空"),
            unit("第二单元 我们的班级",
                 "我爱我们班；班级生活有规则；我是班级值日生；装扮我们的教室。",
                 "爱班级、守班规、做好值日、美化教室。Learning focus: love the class, follow rules and take duty.",
                 "Class identity, rules, duty and classroom care.",
                 "社区", "系统"),
            unit("第三单元 我们在公共场所",
                 "这些是大家的；我们不乱扔；大家排好队；我们小点儿声。",
                 "爱护公共财物，排队轻声。Learning focus: behave well in public places.",
                 "Public property, no littering, lining up, quiet voices.",
                 "社区", "交流"),
            unit("第四单元 我们生活的地方",
                 "我爱家乡山和水；家乡物产养育我；可亲可敬的家乡人；家乡新变化。",
                 "认识家乡山水、物产、人物与变化。Learning focus: know and love one's hometown.",
                 "Hometown landscape, products, people and change.",
                 "文化", "变化"),
        ],
        "Semester 2": [
            unit("第一单元 让我试试看",
                 "挑战第一次；学做“快乐鸟”；做个“开心果”；试种一粒籽。",
                 "勇于尝试新事物，保持乐观。Learning focus: try new things and stay cheerful.",
                 "First tries, optimism and planting a seed.",
                 "发展", "创造力"),
            unit("第二单元 我们好好玩",
                 "健康游戏我常玩；传统游戏我会玩；我们有新玩法；安全地玩。",
                 "健康、传统与创新游戏，注意安全。Learning focus: play healthily, learn traditional games, stay safe.",
                 "Healthy, traditional and safe play.",
                 "文化", "交流"),
            unit("第三单元 绿色小卫士",
                 "小水滴的诉说；清新空气是个宝；我是一张纸；我的环保小搭档。",
                 "节约用水用电用纸，做环保小卫士。Learning focus: save water, air and paper as a young eco-guard.",
                 "Water, air, paper and eco-helpers.",
                 "全球", "关联"),
            unit("第四单元 我会努力的",
                 "我能行；学习有方法；坚持才会有收获；奖励一下自己。",
                 "建立自信，掌握方法，坚持并自我激励。Learning focus: I can do it—methods, persistence and self-reward.",
                 "Confidence, study methods and persistence.",
                 "发展", "身份"),
        ],
    },
    3: {
        "Semester 1": [
            unit("第一单元 做学习的主人",
                 "学习伴我成长；我学习，我快乐；学习有方法。",
                 "热爱学习，找到适合自己的方法。Learning focus: take charge of learning with joy and method.",
                 "Lifelong learning, joy and study methods.",
                 "发展", "逻辑"),
            unit("第二单元 爱科学 学科学",
                 "科技力量大；走近科学家；从小爱科学。",
                 "感受科技力量，学习科学家精神。Learning focus: love science and learn from scientists.",
                 "Technology, scientists and scientific spirit.",
                 "创造力", "关联"),
            unit("第三单元 在集体中成长",
                 "走近我们的老师；同学相伴；让我们的学校更美好。",
                 "尊敬老师、友爱同学、建设学校。Learning focus: grow with teachers and classmates to improve the school.",
                 "Teachers, classmates and a better school.",
                 "关系", "社区"),
            unit("第四单元 公共生活靠大家",
                 "公共场所的文明素养；我们都是热心人；生活离不开规则；安全记心上。",
                 "文明、热心、守规则、注意安全。Learning focus: public manners, kindness, rules and safety.",
                 "Public life: civility, help, rules and safety.",
                 "社区", "系统"),
        ],
        "Semester 2": [
            unit("第一单元 我和我的同伴",
                 "我是独特的；不一样的你我他；我很诚实；同学相伴。",
                 "认识自我独特性，诚实待人，同伴互助。Learning focus: accept uniqueness, be honest, and walk with classmates.",
                 "Uniqueness, honesty and companionship.",
                 "身份", "关系"),
            unit("第二单元 我在这里长大",
                 "我的家在这里；我家的好邻居；请到我的家乡来。",
                 "热爱家乡与邻里，乐于介绍家乡。Learning focus: grow up in a place—home, neighbours and hometown.",
                 "Home, neighbours and inviting others to hometown.",
                 "社区", "文化"),
            unit("第三单元 我们的公共生活",
                 "大家的“朋友”；生活离不开规则；爱心的传递者。",
                 "爱护公共设施，守规则，传递爱心。Learning focus: public goods, rules and passing on kindness.",
                 "Shared facilities, rules and kindness.",
                 "社区", "关系"),
            unit("第四单元 多样的交通和通信",
                 "四通八达的交通；慧眼看交通；万里一线牵。",
                 "了解交通与通信，安全文明出行。Learning focus: transport, traffic sense and staying connected.",
                 "Transport, traffic safety and communication.",
                 "时空", "系统"),
        ],
    },
    4: {
        "Semester 1": [
            unit("第一单元 为父母分担",
                 "少让父母为我操心；这些事我来做；我的家庭贡献与责任。",
                 "体谅父母，承担力所能及的家庭责任。Learning focus: share family work and worry less for parents.",
                 "Helping parents and family responsibility.",
                 "关系", "发展"),
            unit("第二单元 我们一家人",
                 "读懂彼此的心；让我们的家更美好；弘扬优秀家风。",
                 "理解家人、建设美好家庭、传承家风。Learning focus: understand one another and keep family traditions.",
                 "Family understanding, a better home and family ethos.",
                 "文化", "关系"),
            unit("第三单元 与班级共成长",
                 "我们班四岁了；我们的班规我们订；我们班他们班。",
                 "参与班规制定，正确看待班际比较。Learning focus: grow with the class and make class rules together.",
                 "Class history, class rules and other classes.",
                 "社区", "系统"),
            unit("第四单元 同伴与交往",
                 "我们的好朋友；说话要算数；当冲突发生。",
                 "珍惜友谊，守信用，文明处理冲突。Learning focus: friendship, keeping promises and handling conflict.",
                 "Friends, keeping one's word and conflict.",
                 "关系", "交流"),
        ],
        "Semester 2": [
            unit("第一单元 完善自我 健康成长",
                 "学会尊重；学会宽容；学会反思。",
                 "在尊重、宽容与反思中完善自我。Learning focus: respect, tolerance and reflection.",
                 "Respect, tolerance and self-reflection.",
                 "身份", "视角"),
            unit("第二单元 美好生活哪里来",
                 "我们的衣食之源；这些东西哪里来；生活离不开他们。",
                 "懂得劳动创造生活，尊重各行各业。Learning focus: see how labour and many jobs make daily life possible.",
                 "Where food, clothes and goods come from.",
                 "关联", "社区"),
            unit("第三单元 信息万花筒",
                 "健康看电视；网络新世界；正确认识广告。",
                 "理性对待电视、网络与广告。Learning focus: use media healthily and read ads critically.",
                 "TV, the internet and advertising.",
                 "逻辑", "交流"),
            unit("第四单元 做聪明的消费者",
                 "买东西的学问；我想要 我能要；有多少浪费本可以避免。",
                 "理性消费，区分想要与需要，反对浪费。Learning focus: shop wisely, want vs need, reduce waste.",
                 "Smart shopping and less waste.",
                 "逻辑", "系统"),
            unit("第五单元 让生活多一些绿色",
                 "我们所了解的环境污染；变废为宝有妙招；低碳生活每一天。",
                 "认识污染，变废为宝，践行低碳。Learning focus: pollution, recycling and low-carbon days.",
                 "Pollution, recycling and low-carbon living.",
                 "全球", "创造力"),
        ],
    },
    5: {
        "Semester 1": [
            unit("第一单元 面对成长中的新问题",
                 "自主选择课余生活；学会沟通交流；主动拒绝烟酒与毒品。",
                 "自主安排课余，善于沟通，拒绝烟酒毒品。Learning focus: choose after-school life, communicate, refuse tobacco, alcohol and drugs.",
                 "Free time, communication and saying no to harmful substances.",
                 "发展", "身份"),
            unit("第二单元 我们是班级的主人",
                 "选举产生班委会；协商决定班级事务。",
                 "民主选举班委，协商班级事务。Learning focus: elect a class committee and decide together.",
                 "Class elections and consultation.",
                 "社区", "系统"),
            unit("第三单元 我们的国土 我们的家园",
                 "我们神圣的国土；中华民族一家亲。",
                 "认识国土完整与民族团结。Learning focus: our land and one Chinese nation.",
                 "Sacred territory and ethnic unity.",
                 "文化", "全球"),
            unit("第四单元 骄人祖先 灿烂文化",
                 "美丽文字 民族瑰宝；古代科技 耀我中华；传统美德 源远流长。",
                 "了解汉字、古代科技与传统美德。Learning focus: Chinese characters, ancient science and traditional virtues.",
                 "Writing, ancient science and traditional virtues.",
                 "文化", "审美"),
        ],
        "Semester 2": [
            unit("第一单元 公共生活靠大家",
                 "我们的公共生活；建立良好的公共秩序；我参与 我奉献。",
                 "参与公共生活，维护秩序，乐于奉献。Learning focus: public life, order and contribution.",
                 "Public life, order and serving others.",
                 "社区", "交流"),
            unit("第二单元 我们的守护者",
                 "感受生活中的法律；宪法是根本法。",
                 "感知法律就在身边，认识宪法根本地位。Learning focus: law in daily life and the Constitution as fundamental law.",
                 "Everyday law and the Constitution.",
                 "系统", "逻辑"),
            unit("第三单元 我们是公民",
                 "公民意味着什么；公民的基本权利和义务。",
                 "理解公民身份及基本权利义务。Learning focus: what it means to be a citizen—rights and duties.",
                 "Citizenship, rights and duties.",
                 "身份", "系统"),
            unit("第四单元 我们的国家机构 / 法律保护我们健康成长",
                 "国家机构有哪些；人大代表为人民；权力受到制约和监督；我们受特殊保护；知法守法，依法维权。",
                 "了解国家机构与权力监督，学会依法维权。Learning focus: state organs, supervision, and legal protection for children.",
                 "State organs and legal protection for growing up.",
                 "系统", "社区"),
        ],
    },
    6: {
        "Semester 1": [
            unit("第一单元 我们的守护者",
                 "感受生活中的法律；宪法是根本法。",
                 "体会法律保护，理解宪法是根本法。Learning focus: law protects us; the Constitution is fundamental.",
                 "Law in life and the Constitution.",
                 "系统", "逻辑"),
            unit("第二单元 我们是公民",
                 "公民意味着什么；公民的基本权利和义务。",
                 "明确公民身份，正确行使权利、履行义务。Learning focus: citizen identity, basic rights and duties.",
                 "Being a citizen: rights and duties.",
                 "身份", "社区"),
            unit("第三单元 我们的国家机构",
                 "国家机构有哪些；人大代表为人民；权力受到制约和监督。",
                 "认识国家机构与人大代表，理解权力制约。Learning focus: state organs, people's congress deputies, and checks on power.",
                 "State organs, deputies and supervision.",
                 "系统", "视角"),
            unit("第四单元 法律保护我们健康成长",
                 "我们受特殊保护；知法守法，依法维权。",
                 "了解未成年人特殊保护，知法守法维权。Learning focus: special protection for minors and lawful self-help.",
                 "Special protection and lawful rights defence.",
                 "发展", "系统"),
        ],
        "Semester 2": [
            unit("第一单元 完善自我 健康成长",
                 "学会尊重；学会宽容；学会反思。",
                 "以尊重、宽容、反思完善自我，迎接小学毕业。Learning focus: respect, tolerance and reflection before leaving primary school.",
                 "Respect, tolerance and reflection.",
                 "身份", "发展"),
            unit("第二单元 爱护地球 共同责任",
                 "地球——我们的家园；应对自然灾害。",
                 "爱护地球家园，了解防灾减灾。Learning focus: Earth as home and responding to natural disasters.",
                 "The Earth and disaster response.",
                 "全球", "关联"),
            unit("第三单元 多样文明 多彩生活",
                 "探访古代文明；多元文化 多样魅力。",
                 "尊重多样文明与文化。Learning focus: ancient civilisations and cultural diversity.",
                 "Ancient civilisations and cultural diversity.",
                 "文化", "视角"),
            unit("第四单元 让世界更美好",
                 "科技发展 造福人类；日益重要的国际组织；我们爱和平。",
                 "认识科技、国际组织与和平愿景。Learning focus: science for humanity, international organisations and peace.",
                 "Science, international organisations and peace.",
                 "全球", "发展"),
        ],
    },
    7: {
        "Semester 1": [
            unit("第一单元 少年有梦",
                 "开启初中生活；正确认识自我；梦想始于当下。",
                 "适应初中，正确认识自我，用学习成就梦想。Learning focus: start junior high, know yourself, and begin a dream now.",
                 "Junior-high start, self-knowledge and dreams.",
                 "身份", "发展"),
            unit("第二单元 成长的时空",
                 "幸福和睦的家庭；和谐的师生关系；友谊之树常青；在集体中成长。",
                 "经营家庭、师生、友谊与集体关系。Learning focus: family, teachers, friendship and the collective.",
                 "Family, teachers, friendship and class community.",
                 "关系", "社区"),
            unit("第三单元 珍爱我们的生命",
                 "生命可贵；守护生命安全；保持身心健康。",
                 "敬畏生命，增强安全防护，爱护身心。Learning focus: value life, stay safe, and keep body and mind healthy.",
                 "Life, safety and physical/mental health.",
                 "发展", "系统"),
            unit("第四单元 追求美好人生",
                 "确立人生目标；端正人生态度；实现人生价值。",
                 "树立正确目标与态度，在劳动与奉献中创造价值。Learning focus: goals, attitudes, and creating value through work and service.",
                 "Life goals, attitudes and creating value.",
                 "视角", "发展"),
        ],
        "Semester 2": [
            unit("第一单元 青春与情绪",
                 "青春正当时；做情绪情感的主人。",
                 "正确认识青春期变化，管理情绪情感。Learning focus: adolescence and being master of emotions.",
                 "Youth and emotional self-regulation.",
                 "变化", "身份"),
            unit("第二单元 自尊 自信 自强",
                 "人贵自尊；自信给人力量；人生当自强。",
                 "培养自尊自信自强的品质。Learning focus: self-respect, confidence and self-reliance.",
                 "Dignity, confidence and self-strength.",
                 "身份", "发展"),
            unit("第三单元 中华文化与美德",
                 "传承核心思想理念；弘扬中华人文精神；践行中华传统美德。",
                 "传承思想理念、人文精神与传统美德。Learning focus: core ideas, humanistic spirit and traditional virtues.",
                 "Chinese thought, humanistic spirit and virtues.",
                 "文化", "审美"),
            unit("第四单元 法律护航成长",
                 "法律为我们护航；走近民法典；远离违法犯罪。",
                 "树立法治意识，了解民法典，远离违法犯罪。Learning focus: law protects us—Civil Code and staying away from crime.",
                 "Law, the Civil Code and staying clear of crime.",
                 "系统", "逻辑"),
        ],
    },
    8: {
        "Semester 1": [
            unit("第一单元 走进社会生活",
                 "丰富的社会生活；在社会中健康成长；共建网络美好家园。",
                 "认识社会生活与社会化，文明健康使用网络。Learning focus: social life, growing in society, and a healthy online home.",
                 "Social life, socialisation and the internet.",
                 "社区", "交流"),
            unit("第二单元 维护社会秩序",
                 "遵守社会规则；社会生活讲道德；提升法治素养。",
                 "守规则、讲道德、依法办事。Learning focus: rules, morality in social life, and legal literacy.",
                 "Rules, social morality and the rule of law.",
                 "系统", "文化"),
            unit("第三单元 勇担社会责任",
                 "责任与角色同在；积极奉献社会；追求自由平等与公平正义。",
                 "理解责任，关爱他人、服务社会。Learning focus: roles and responsibility, service, freedom, equality and justice.",
                 "Responsibility, service, freedom and justice.",
                 "关系", "社区"),
            unit("第四单元 维护国家利益",
                 "国家利益至上；树立总体国家安全观；建设美好祖国。",
                 "坚持国家利益，维护国家安全，关心国家发展。Learning focus: national interest, overall national security, and building the country.",
                 "National interest, security and a better motherland.",
                 "全球", "身份"),
        ],
        "Semester 2": [
            unit("第一单元 坚持宪法至上",
                 "维护宪法权威；保障宪法实施。公民权利的保障书，治国安邦的总章程；依宪治国与宪法监督。",
                 "理解宪法地位，维护宪法权威与实施。Learning focus: the Constitution as fundamental law and how it is implemented.",
                 "Constitutional authority and implementation.",
                 "系统", "逻辑"),
            unit("第二单元 理解权利义务",
                 "公民权利；公民义务。基本权利与依法行使；基本义务与依法履行。",
                 "正确行使权利、自觉履行义务。Learning focus: citizens' rights and duties under the law.",
                 "Rights, duties and exercising them lawfully.",
                 "身份", "系统"),
            unit("第三单元 认识国家制度 / 走近国家机构",
                 "我国基本制度；我国国家机构。基本经济制度、根本政治制度、基本政治制度；权力机关、行政机关、监察机关、司法机关等。",
                 "认识中国特色社会主义制度与国家机构。Learning focus: basic systems and state organs of China.",
                 "Basic systems and state institutions.",
                 "系统", "社区"),
            unit("第四单元 崇尚法治精神 / 建设法治中国",
                 "尊重自由平等；维护公平正义。自由平等的真谛与追求；公平正义的价值与守护。",
                 "崇尚法治精神，建设法治中国。Learning focus: freedom, equality, fairness, justice and a China under the rule of law.",
                 "Rule-of-law spirit: freedom, equality, fairness and justice.",
                 "视角", "文化"),
        ],
    },
    9: {
        "Semester 1": [
            unit("第一单元 富强与创新",
                 "踏上强国之路（坚持改革开放、走向共同富裕）；创新驱动发展（创新改变生活、创新永无止境）。",
                 "理解改革开放与共同富裕，认识创新驱动。Learning focus: the path to prosperity and innovation-driven development.",
                 "Reform, common prosperity and innovation.",
                 "发展", "变化"),
            unit("第二单元 民主与法治",
                 "追求民主价值（生活在民主国家、参与民主生活）；建设法治中国（夯实法治基石、凝聚法治共识）。",
                 "理解全过程人民民主与法治中国。Learning focus: democratic values and building China under the rule of law.",
                 "Democracy in daily life and the rule of law.",
                 "系统", "社区"),
            unit("第三单元 文明与家园",
                 "守望精神家园（延续文化血脉、凝聚价值追求）；建设美丽中国（正视发展挑战、共筑生命家园）。",
                 "传承中华文化，建设美丽中国。Learning focus: cultural heritage, core values and a beautiful China.",
                 "Spiritual home and a beautiful China.",
                 "文化", "全球"),
            unit("第四单元 和谐与梦想",
                 "中华一家亲（促进民族团结、维护国家统一）；中国人 中国梦（我们的梦想、共圆中国梦）。",
                 "促进民族团结与国家统一，理解中国梦。Learning focus: one family of the Chinese nation and the Chinese Dream.",
                 "National unity and the Chinese Dream.",
                 "身份", "关系"),
        ],
        "Semester 2": [
            unit("第一单元 我们共同的世界",
                 "同住地球村（开放互动的世界、复杂多变的关系）；构建人类命运共同体（推动和平与发展、谋求互利共赢）。",
                 "认识当今世界，理解人类命运共同体。Learning focus: one global village and a community with a shared future.",
                 "The world we share and a shared future for mankind.",
                 "全球", "关系"),
            unit("第二单元 世界舞台上的中国",
                 "与世界紧相连（中国担当、与世界深度互动）；与世界共发展（中国的机遇与挑战、携手促发展）。",
                 "认识中国与世界的互动及发展机遇挑战。Learning focus: China on the world stage—responsibility, opportunity and challenge.",
                 "China connected with and developing with the world.",
                 "全球", "发展"),
            unit("第三单元 走向未来的少年",
                 "少年的担当（走向世界大舞台、少年当自强）；我的毕业季（学无止境、多彩的职业）；从这里出发（回望成长、走向未来）。",
                 "明确少年担当，规划毕业与未来。Learning focus: a young person's duty, graduation and setting out.",
                 "Youth responsibility, graduation and the future.",
                 "身份", "发展"),
        ],
    },
}


def build_units(grade: int, semester: str, raw: list[dict]) -> list[dict]:
    weeks = split_weeks(len(raw))
    wp = weekly_periods(grade)
    stamp = f"df-g{grade}-{'s1' if semester.endswith('1') else 's2'}"
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
            payload = {"courseId": course_id, "grade": grade, "semester": semester, "units": units}
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
    for grade in range(1, 10):
        for semester in ("Semester 1", "Semester 2"):
            url = f"{API}/semester/{course_id}/{grade}/{urllib.parse.quote(semester)}"
            data = request_json("GET", url, token=token)
            n = len(data.get("units") or [])
            expect = len(CATALOG[grade][semester])
            if n != expect:
                print(f"VERIFY FAIL G{grade} {semester}: got {n}, expect {expect}", file=sys.stderr)
                return 1
    print("Verify: all 18 道法 semesters match catalog unit counts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
