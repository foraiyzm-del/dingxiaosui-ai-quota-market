const articles=[
  {id:'first-content',number:'01',category:'内容创作',minutes:'5 分钟',title:'30 分钟，写出第一条山西农品内容',summary:'从已核实的商品事实出发，写一条能回答顾客问题的内容。',sections:[
    {title:'先准备一张商品事实卡',paragraphs:['写清商品名称、产地、生产者、规格、保质期、参考价格和发货条件。只使用供应商确认并授权的图片和说法。'],list:['商品标签与供货资料一致。','产地和认证有可核实的依据。','不要编造功效、销量或客户评价。']},
    {title:'一条内容只回答一个问题',paragraphs:['先明确顾客的真实用途，例如家庭餐桌、节日伴手礼或企业采购。开头写顾客常问的问题，中间用商品事实回答，结尾保留一个咨询动作。']},
    {title:'按渠道重写',paragraphs:['朋友圈写短说明，小红书列清选择依据，视频号拍真实商品与使用场景。每次发布前核对库存、价格和图片授权。']},
    {title:'可直接使用的简报',paragraphs:['顾客是谁：____；使用场景：____；客户问题：____；已确认事实：____；需要核实：____；希望客户下一步：____。填好后进入工作台生成初稿，并人工审核。']}
  ],tip:'先看实际咨询和客户原话，再决定下一条内容。'},
  {id:'city-marketing',number:'02',category:'本地营销',minutes:'6 分钟',title:'一座城市、一款农品：如何做首轮测试',summary:'用小范围访谈确认场景，再做一次可复盘的推广。',sections:[
    {title:'先找真实商品',paragraphs:['从地图选一条公开产区线索，再找到具体供货主体。公开产区资料不能替代商品资质、批次和合作授权。']},
    {title:'访谈目标客户',paragraphs:['访问 5 位可能购买的顾客和 2 家门店，记录他们对用途、规格、价格、配送和退换的原话。不要把产地知名度当成客户偏好的证明。']},
    {title:'做一轮内容测试',paragraphs:['选择一个明确场景，准备三条不同角度的内容。发布后记录咨询人数、重复问题、供货响应时间与最终结果。']},
    {title:'在工作台里落地',paragraphs:['建立农品档案，生成内容初稿，安排发布，记录客户咨询与效果。下一轮只放大有真实反馈的做法。']}
  ],tip:'第一轮目标是找到可重复的场景和可供货的商品。'},
  {id:'opc-start',number:'03',category:'OPC 经营',minutes:'6 分钟',title:'紫丁香 OPC 第一周行动表',summary:'从选品到咨询，跑通一个人能完成的小闭环。',sections:[
    {title:'第 1 天：明确商品与责任',paragraphs:['确认具体商品、供货主体、可用素材，以及价格、发货、发票和售后由谁负责。授权未确认时仅作内部演示。']},
    {title:'第 2—3 天：建档和创作',paragraphs:['录入产地、规格、保存条件、真实特点。选择一个客户问题，生成不同渠道的内容并人工核实。']},
    {title:'第 4—5 天：小范围触达',paragraphs:['发布到合适的渠道，保留链接与时间。顾客咨询时记录原话、数量、用途和交付城市。']},
    {title:'第 6—7 天：复盘',paragraphs:['查看哪些问题重复出现，判断问题在内容、价格、供货还是履约。保留有效模板，下周只改一两个变量。']},
    {title:'当前边界',paragraphs:['演示版有工作台、个人小店预览和咨询记录，没有正式账号、真实订单、支付、供货或履约服务。']}
  ],tip:'一周交付物：一份商品档案、三条内容、一张咨询记录。'},
  {id:'system-manual',number:'04',category:'系统使用',minutes:'5 分钟',title:'紫丁香使用手册：地图、工作台与小店',summary:'按顺序把一款真实农品从资料变成可查看的展示页。',sections:[
    {title:'一、看产区线索',paragraphs:['首页地图展示山西 11 市的创意导航。附来源的城市可查看公开农品线索；其他城市提示先做调研。']},
    {title:'二、建立农品档案',paragraphs:['到“农品资料”新增商品。录入真实产地、供货主体、规格、保存条件、介绍和已确认特点。']},
    {title:'三、创作与复盘',paragraphs:['在“内容创作”选商品、场景和渠道。修改初稿后加入发布计划，再录入实际浏览与咨询数据。']},
    {title:'四、设置个人小店',paragraphs:['在“我的 OPC 农品小店”填写主理人信息并选择要展示的商品。买家演示页提交的咨询会进入本浏览器工作台。']},
    {title:'五、保存范围',paragraphs:['登录后工作台与小店资料保存到服务器，同一账号可换设备读取；访客资料仍仅在本机。社区帖子由独立服务管理，重要资料仍请及时导出备份。']}
  ],tip:'先用真实商品替换虚构示例，再开始对外推广。'},
  {id:'shanxi-atlas',number:'05',category:'山西风物',minutes:'8 分钟',title:'一堂课，认识山西农产品的五种地域线索',summary:'从“南果、中粮、北肉、东药材、西干果”读懂山西物产格局，再寻找具体商品。',source:'https://nynct.shanxi.gov.cn/sndt/nyyw/202601/t20260122_10044589.html',sections:[
    {title:'先有一张全省图',paragraphs:['山西省农业农村厅用“南果、中粮、北肉、东药材、西干果”概括农业特色布局。这是观察产区的线索，不等于每个地方只生产一种产品。']},
    {title:'从地区走向商品',paragraphs:['晋南可以关注果品，晋中及周边关注杂粮和加工食品，雁门一带关注肉羊，东西不同区域也各有药材和干果产业。具体做内容时，落到城市、县域、生产者和商品批次。'],list:['地域线索：哪里有相关产业。','商品事实：谁生产、什么规格、何时供货。','顾客场景：家庭餐桌、伴手礼还是企业采购。']},
    {title:'不要把地图当成供货表',paragraphs:['公开报道能帮助找方向。是否有货、是否可用品牌名、图片能否使用、如何发货，仍应由具体生产者确认。']}
  ],tip:'选一座城、一款商品，查到生产者和可核实资料，才开始写推广内容。'},
  {id:'taste-notes',number:'06',category:'山西风物',minutes:'7 分钟',title:'山西好物怎么讲口味？从香、脆、糯、酸开始',summary:'把主观风味写成可体验、可核实的描述，避免把所有农品都写成“最好吃”。',source:'https://nynct.shanxi.gov.cn/sndt/nyyw/202512/t20251229_10023042.html',sections:[
    {title:'先分清事实和感受',paragraphs:['“来自隰县”“净含量 5 公斤”是可核实事实；“脆嫩”“谷香”“软糯”是品类或品尝感受。一个人的口味不能直接代表所有批次。']},
    {title:'四种常用感官维度',paragraphs:['果品可以写咬下去的脆度和汁水感；杂粮可以写煮后的香气与口感；干果可以写甜度与嚼感；调味品可以写酸香及搭配方式。'],list:['感官词旁边写明品种、做法或样品来源。','让真实试吃者记录原话，不替顾客编评价。','避免医疗、保健或绝对化效果表述。']},
    {title:'一张口味卡模板',paragraphs:['商品与批次：____；品种：____；吃法：____；香气：____；口感：____；搭配：____；试吃人原话：____。']}
  ],tip:'风味是邀请体验的语言，实际商品仍要以真实样品和标签为准。'},
  {id:'produce-stories',number:'07',category:'内容创作',minutes:'6 分钟',title:'把产地故事写成一条能发布的短视频',summary:'用产地、生产者、商品和餐桌四个镜头，讲清一款山西好物。',source:'https://nynct.shanxi.gov.cn/sndt/tpxw/202512/t20251204_10007539.html',sections:[
    {title:'四镜头结构',paragraphs:['第一镜：产地和具体地点。第二镜：生产者与真实工序。第三镜：商品包装、规格与标签。第四镜：真实使用场景和咨询入口。'],list:['每一个画面都需要素材使用权。','每一个数字与认证都有可查的依据。','结尾引导咨询，不虚构限量与优惠。']},
    {title:'30 秒口播模板',paragraphs:['“这款____来自山西____，由____生产。我们核实到它的____。如果你正在寻找____场景的商品，可以先看清____规格和____配送信息，再决定是否适合。”']}
  ],tip:'发布前请生产者核对每一条事实。'},
  {id:'ai-new-farmer-media',number:'08',category:'AI 实训',minutes:'8 分钟',title:'AI 新农人第一周：短视频与直播怎么练',summary:'用一款真实农品，完成账号定位、五条选题、一份拍摄单和一场直播演练。',sections:[
    {title:'第 1 步：写清你的账号定位',paragraphs:['用一句话说明你是谁、主要讲哪类山西农品、能为谁解决什么选择问题。例如“用真实产地资料，帮家庭用户看懂山西杂粮怎么选”。这句话要能被真实商品与经历支撑。']},
    {title:'第 2 步：让 AI 帮你排五条选题',paragraphs:['先给工作台真实商品档案，再围绕“产地与生产者、口味与吃法、包装与规格、常见疑问、客户使用场景”各出一条选题。AI 只负责整理角度和初稿，价格、库存、认证与客户评价由人核对。'],list:['每条视频只回答一个真实问题。','每条列出需要拍到的实物、人物或场景。','没有素材授权的镜头不要列入拍摄单。']},
    {title:'第 3 步：按 30 秒脚本拍第一条',paragraphs:['前 3 秒提出一个顾客问题；接着用真实商品镜头给出信息；最后说清适合谁、还需要核实什么、如何咨询。拍完先看观众能否听懂商品名称、规格与用途，再考虑镜头是否漂亮。']},
    {title:'第 4 步：做一场直播演练',paragraphs:['先确认可介绍的商品、价格、库存、发货与售后责任，再写开场、商品展示、常见问答和结束复盘四段提纲。可先录一场不公开的演练，检查讲解是否清楚、镜头与收音是否稳定；正式开播和交易仍由经营主体自行负责。']},
    {title:'第 5 步：用真实反馈改下一期',paragraphs:['记录哪一段被问得最多、哪些商品事实还不清楚、哪些说法需要供货方确认。用这些反馈更新农品档案、下周选题和直播问答，不用虚构播放量或成交效果。']}
  ],tip:'第一周交付物：一句账号定位、五条选题、一张拍摄单、一场直播演练记录。'}
];

articles.push(
  {id:'aigc-one-idea',number:'09',category:'AIGC 创作',minutes:'7 分钟',title:'一款农品，生成五种不同渠道的内容',summary:'让 AI 按同一份真实资料写朋友圈、小红书、视频号、知乎和导购卡。',sections:[
    {title:'先给资料，不先给口号',paragraphs:['准备商品名称、产地、规格、使用场景、已确认卖点和不能说的话。缺少的事实明确写“待核实”，不要让模型补齐。']},
    {title:'一份简报，五种表达',paragraphs:['提示词写清“目标顾客、平台、语气、篇幅、行动建议”。朋友圈简短，小红书突出选择依据，视频号给镜头与口播，知乎回答具体问题，导购卡方便现场说明。'],list:['同一商品事实在各渠道保持一致。','标题和开头可不同，价格、认证、库存不能随意变化。','每一版都由经营者审核再发布。']},
    {title:'动手练习',paragraphs:['在工作台录入一款真实农品，以“顾客最常问的一个问题”为主题生成多渠道初稿。圈出三处需要补证据或改语气的句子。']}
  ],tip:'交付物：一份事实卡、五条待审初稿、一张人工核验清单。'},
  {id:'aigc-visual',number:'10',category:'AIGC 创作',minutes:'7 分钟',title:'AI 图片与包装提案：从灵感图到可用物料',summary:'学会写视觉简报、辨别概念图与商品实拍，并把设计交给人复核。',sections:[
    {title:'写出视觉简报',paragraphs:['写明商品类别、品牌色、包装结构、目标客群、货架或手机屏幕的使用场景。把“想要高级”改成可判断的版式、材质与信息层级。']},
    {title:'保留真实边界',paragraphs:['AI 生成图可用于创意讨论，不能冒充真实产地、生产者、商品包装或已完成的门店。商标、标签、净含量、配料、食品信息要从正式资料核对。']},
    {title:'动手练习',paragraphs:['给一款农品做两种包装概念：日常小规格与礼赠款。分别标出正面必须出现的信息、侧面的商品说明和待打样的材质。']}
  ],tip:'交付物：一页视觉简报和两张清楚标注“概念图”的方案。'},
  {id:'code-first-page',number:'11',category:'编程能力',minutes:'9 分钟',title:'零基础写一张农品介绍网页',summary:'理解 HTML、CSS 与按钮链接，让商品事实变成可读的网页。',sections:[
    {title:'先认识三个角色',paragraphs:['HTML 管结构：标题、图片、商品信息与咨询入口。CSS 管排版：颜色、间距与手机适配。JavaScript 管交互：切换图片、展开说明或记录按钮点击。']},
    {title:'只做一张事实卡',paragraphs:['页面先放商品名、真实照片、产地、规格、保存方式和供货说明。用一个链接指向正式咨询入口；没有实际订单服务时，不写“立即购买”造成误解。']},
    {title:'动手练习',paragraphs:['用自己的商品资料，画出“标题—图片—三项事实—常见问题—咨询方式”的手机页面线框。再尝试用 HTML 标签写出标题、段落和列表。']}
  ],tip:'交付物：一页可在手机上阅读的农品介绍页草稿。'},
  {id:'code-data-board',number:'12',category:'编程能力',minutes:'9 分钟',title:'用数据做一张内容复盘看板',summary:'从发布记录里计算真实咨询数，理解表格、字段与简单逻辑。',sections:[
    {title:'先把字段定清楚',paragraphs:['每条内容记录发布日期、平台、商品、主题、实际浏览、咨询、客户问题和是否形成有效跟进。不要把曝光、询问与成交混成同一个数字。']},
    {title:'再做两个小计算',paragraphs:['按平台汇总咨询数，找出哪类主题更容易引出真实问题；按商品统计待回答的问题。先用表格完成，再考虑用 JavaScript 自动筛选和排序。']},
    {title:'动手练习',paragraphs:['选最近五条实际内容，补齐字段，画一个“平台 × 咨询数”的小表。写一句下一轮只改变什么变量。']}
  ],tip:'交付物：五条真实记录和一个可解释的小看板。'},
  {id:'agent-knowledge',number:'13',category:'智能体能力',minutes:'8 分钟',title:'搭一个懂自家农品的问答智能体',summary:'把商品事实、常见问题和不能回答的范围写成可维护的知识库。',sections:[
    {title:'把知识分成三层',paragraphs:['第一层是已确认商品事实；第二层是顾客常见问题与来源；第三层是需要转人工确认的价格、库存、资质、售后与个别订单问题。每条资料标注提供方和更新日期。']},
    {title:'给智能体设边界',paragraphs:['回答时先引用知识库中的具体资料。资料没有写到的内容，就说“目前没有核实信息”，并提示人工确认。不要编造功效、认证、销量或供货承诺。']},
    {title:'动手练习',paragraphs:['收集一款农品的十个真实问题，给每个问题写“可直接回答”“需核实”“必须转人工”三个标签，再用同一组问题测试智能体。']}
  ],tip:'交付物：一份带来源与日期的知识库，以及十问测试记录。'},
  {id:'agent-workflow',number:'14',category:'智能体能力',minutes:'8 分钟',title:'让智能体协助选题、写稿与审核',summary:'把重复工作连成流程，保留关键的人审节点。',sections:[
    {title:'定义一个可控流程',paragraphs:['输入商品事实和本周顾客问题；先给出三条选题；选中后写多渠道初稿；最后由人检查事实、语气和发布权限。每一步都保存版本。']},
    {title:'哪些动作先不要自动化',paragraphs:['没有授权的素材抓取、自动私信客户、自动发布和自动承诺价格库存，均不应作为入门流程的默认动作。先把内部草稿流跑通。']},
    {title:'动手练习',paragraphs:['用箭头画出“资料输入→选题→脚本→核验→发布计划”的五步流程，标出两个必须人工确认的位置。']}
  ],tip:'交付物：一张智能体流程图和一份人审清单。'},
  {id:'llm-basics',number:'15',category:'大模型能力',minutes:'8 分钟',title:'大模型能做什么，为什么会说错',summary:'理解上下文、生成与核验的关系，知道何时该让模型停下来。',sections:[
    {title:'把模型当成写作和整理助手',paragraphs:['大模型擅长归纳、改写、提问和生成结构化初稿，但它不会自动知道你今天的库存、真实产地、有效授权或最新价格。答案说得流畅，不等于事实已经核实。']},
    {title:'分清事实、推断与建议',paragraphs:['提示模型把输入中的已确认事实单独列出，把需要查询的内容标为“待核实”，把营销角度标为“建议”。三类信息不能混写。']},
    {title:'动手练习',paragraphs:['拿一张不完整的商品卡提问：“这款产品有什么认证？”检查模型是否诚实回答“资料未提供”，并记录错误说法。']}
  ],tip:'交付物：一张“模型可以做／必须人工核实”的边界表。'},
  {id:'llm-prompt-eval',number:'16',category:'大模型能力',minutes:'9 分钟',title:'给大模型写任务书，再用十问评测它',summary:'用角色、资料、任务、格式与禁区，让输出更稳定、可审核。',sections:[
    {title:'一个实用任务书',paragraphs:['角色：山西农品内容助理。资料：只用已确认的商品卡。任务：为指定顾客写三条选题。格式：每条包含标题、证据、镜头和待核实项。禁区：不编价格、功效和销量。']},
    {title:'自己建立测试集',paragraphs:['准备十个问题，包含正常问题、资料缺失问题、诱导夸大问题和售后问题。每次更换模型或知识库后，用同一组问题复测。']},
    {title:'动手练习',paragraphs:['拿同一款农品写一版含糊提示词、一版完整任务书，比较错误事实、可执行性和修改所需时间。']}
  ],tip:'交付物：一份可复用任务书和十问评测表。'}
);

const academyTracks=[
  {id:'media',no:'01',symbol:'▶',name:'短视频与直播',english:'VIDEO & LIVE',summary:'定账号、找选题、写分镜、排直播执行单。',outcome:'交付：一周拍摄表＋一场直播演练'},
  {id:'aigc',no:'02',symbol:'✦',name:'AIGC 创作',english:'GENERATIVE CONTENT',summary:'把一份真实农品资料变成多渠道图文与视觉提案。',outcome:'交付：多渠道内容包＋视觉简报'},
  {id:'code',no:'03',symbol:'⌘',name:'编程能力',english:'CODE & DATA',summary:'从网页和数据字段入手，自己做小工具与复盘看板。',outcome:'交付：一页商品页＋数据看板'},
  {id:'agent',no:'04',symbol:'◈',name:'智能体能力',english:'AGENT WORKFLOWS',summary:'让知识库、选题、写稿和人工审核连成可控流程。',outcome:'交付：农品问答智能体设计'},
  {id:'model',no:'05',symbol:'◎',name:'大模型能力',english:'MODEL LITERACY',summary:'理解模型能做什么、会怎样出错，学会提示与评测。',outcome:'交付：任务书＋十问测试集'},
];
const articleTracks={
  'first-content':'aigc','city-marketing':'foundation','opc-start':'foundation','system-manual':'foundation','shanxi-atlas':'foundation','taste-notes':'foundation','produce-stories':'media','ai-new-farmer-media':'media',
  'aigc-one-idea':'aigc','aigc-visual':'aigc','code-first-page':'code','code-data-board':'code','agent-knowledge':'agent','agent-workflow':'agent','llm-basics':'model','llm-prompt-eval':'model'
};

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmtDate=value=>new Date(value).toLocaleDateString('zh-CN',{year:'numeric',month:'numeric',day:'numeric'});
const profileKey='zidingxiang-opc-profile-v1';
const ownerKey='zidingxiang-community-owner-v1';
const ownPostsKey='zidingxiang-community-post-ids-v1';
let ownerToken=window.zdxStorage.local.getItem(ownerKey);
if(!ownerToken){ownerToken=crypto.randomUUID();window.zdxStorage.local.setItem(ownerKey,ownerToken);}
let ownPostIds=[];try{const parsed=JSON.parse(window.zdxStorage.local.getItem(ownPostsKey));if(Array.isArray(parsed))ownPostIds=parsed;}catch{}
let profile={};try{profile=JSON.parse(window.zdxStorage.local.getItem(profileKey))||{};}catch{}
let posts=[],activeKind='all',activeCategory='all',currentPostId=null;
let communityLocalMode=false;
const localPostsKey='zidingxiang-community-local-posts-v1';
async function loadLocalPosts(){
  let saved;
  try{saved=JSON.parse(window.zdxStorage.local.getItem(localPostsKey)||'null');}catch{}
  if(Array.isArray(saved))return saved;
  const response=await fetch('community-seed.json');
  if(!response.ok)throw new Error('学院内容暂时无法读取');
  const data=await response.json();
  return Array.isArray(data.posts)?data.posts.slice().reverse():[];
}
function saveLocalPosts(){window.zdxStorage.local.setItem(localPostsKey,JSON.stringify(posts.slice(0,500)));}
let toastTimer;
function toast(message){const el=$('#community-toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,3500);}

let activeAcademyTrack='media';
function renderGuides(){
  $('#academy-track-grid').innerHTML=academyTracks.map(track=>{
    const count=articles.filter(item=>articleTracks[item.id]===track.id).length;
    return `<button type="button" class="academy-track ${track.id===activeAcademyTrack?'active':''}" data-academy-track="${track.id}" aria-pressed="${track.id===activeAcademyTrack}"><span class="academy-track-top"><small>${track.no} / ${track.english}</small><i>${track.symbol}</i></span><strong>${track.name}</strong><span class="academy-track-summary">${track.summary}</span><span class="academy-track-foot">${count} 门入门课 <b>↗</b></span></button>`;
  }).join('');
  $$('[data-academy-track]').forEach(button=>{
    const chosen=button.dataset.academyTrack===activeAcademyTrack;
    button.classList.toggle('active',chosen);
    button.setAttribute('aria-pressed',String(chosen));
  });
  const current=academyTracks.find(track=>track.id===activeAcademyTrack);
  const shown=activeAcademyTrack==='all'?articles:articles.filter(item=>articleTracks[item.id]===activeAcademyTrack);
  const title=current?.name||(activeAcademyTrack==='foundation'?'农品与经营基础':'全部入门课程');
  const summary=current?.outcome||(activeAcademyTrack==='foundation'?'先认识真实农品、客户与 OPC 经营，再进入五条能力路径。':'五条能力路径与农品经营基础课，按自己的起点选择。');
  $('#academy-course-heading').innerHTML=`<div><span>SELECTED LEARNING PATH / ${shown.length} 门入门课</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(summary)}</p></div><small>阅读课程 → 完成练习 → 用真实农品验证</small>`;
  $('#guide-grid').innerHTML=shown.map(item=>`<article class="guide-card" data-number="${item.number}"><div class="guide-card-top"><span>${escapeHtml(item.category)} / ${escapeHtml(item.minutes)}</span><span>AI 新农人培育学院 · 入门课程</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p><button type="button" data-article="${item.id}">阅读全文 ↗</button></article>`).join('');
}
function openArticle(id){
  const item=articles.find(article=>article.id===id);if(!item)return;
  $('#article-content').innerHTML=`<div class="article-meta">AI 新农人培育学院 / ${escapeHtml(item.category)} / ${escapeHtml(item.minutes)}</div><h2>${escapeHtml(item.title)}</h2><p class="lead">${escapeHtml(item.summary)}</p>${item.sections.map(section=>`<section><h3>${escapeHtml(section.title)}</h3>${(section.paragraphs||[]).map(p=>`<p>${escapeHtml(p)}</p>`).join('')}${section.list?`<ul>${section.list.map(line=>`<li>${escapeHtml(line)}</li>`).join('')}</ul>`:''}</section>`).join('')}<div class="article-tip">${escapeHtml(item.tip)}</div>${item.source?`<p class="article-source"><a href="${item.source}" target="_blank" rel="noopener">查看公开资料来源 ↗</a></p>`:''}<div class="article-end">紫丁香计划 · AI 新农人培育学院 · 发布前请核实农品事实和素材授权。</div>`;
  $('#article-dialog').showModal();
}

async function loadPosts(){
  $('#community-status').textContent='正在加载本地社区内容…';
  try{
    if(communityLocalMode){posts=await loadLocalPosts();$('#community-status').textContent=`本浏览器演示社区 · ${posts.length} 条内容（含编辑课程）`;renderPosts();return;}
    const response=await fetch('/api/community',{cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'读取失败');
    posts=Array.isArray(data.posts)?data.posts:[];
    $('#community-status').textContent=`紫丁香社区 · ${posts.length} 条公开内容（含编辑课程）`;
    renderPosts();
  }catch(error){
    try{communityLocalMode=true;posts=await loadLocalPosts();$('#community-status').textContent=`本浏览器演示社区 · ${posts.length} 条内容（含编辑课程）`;renderPosts();}
    catch{$('#community-status').textContent='学院内容暂时无法连接。';$('#post-list').innerHTML='<div class="empty-posts"><b>学院内容暂时无法连接</b><p>请刷新页面后重试。</p></div>';}
  }
}
function renderPosts(){
  const filtered=posts.filter(post=>(activeKind==='all'||post.kind===activeKind)&&(activeCategory==='all'||post.category===activeCategory));
  $('#post-list').innerHTML=filtered.length?filtered.map(post=>`<article class="post-card ${post.editorial?'editorial-post':''}"><div class="post-card-top"><span class="post-kind ${post.kind==='article'?'article':''}">${post.pinned?'置顶 · ':post.featured?'精选 · ':''}${post.editorial?'学院课程':post.kind==='article'?'经验文章':'讨论'}</span><small>${escapeHtml(post.category)} · ${fmtDate(post.createdAt)}</small></div><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.body)}</p><div class="post-card-bottom"><span>${escapeHtml(post.author)}</span><i class="dot"></i><span>${escapeHtml(post.province||'地区未填')}</span><i class="dot"></i><span>${(post.replies||[]).length} 条回复</span><button type="button" data-post="${post.id}">阅读与回复 ↗</button></div></article>`).join(''):'<div class="empty-posts"><b>这里还没有这类内容</b><p>把你正在遇到的一个真实问题发出来，做这个话题的第一位主理人。</p><button data-compose type="button">发布第一条 ↗</button></div>';
}
function renderPostDetail(){
  const post=posts.find(item=>item.id===currentPostId);if(!post)return;
  $('#post-content').innerHTML=`<div class="post-detail-meta">${post.kind==='article'?'经验文章':'主理人讨论'} / ${escapeHtml(post.category)} / ${fmtDate(post.createdAt)}</div><h2>${escapeHtml(post.title)}</h2><p class="lead">${escapeHtml(post.author)}${post.province?` · ${escapeHtml(post.province)}`:''}</p><p class="post-body">${escapeHtml(post.body)}</p>${post.editorial&&post.source?`<p class="post-source"><a href="${escapeHtml(post.source)}" target="_blank" rel="noopener">查看本课程公开资料来源 ↗</a></p>`:''}<div class="reply-section"><h3>回复 · ${(post.replies||[]).length}</h3>${(post.replies||[]).length?(post.replies||[]).map(reply=>`<div class="reply-card"><b>${escapeHtml(reply.author)}</b><small>${fmtDate(reply.createdAt)}</small><p class="post-body">${escapeHtml(reply.body)}</p></div>`).join(''):'<p>还没有回复，欢迎写下你的做法或问题。</p>'}<form class="reply-form" id="reply-form"><input name="author" maxlength="24" required placeholder="你的称呼" value="${escapeHtml(profile.name||'')}"><textarea name="body" maxlength="1200" rows="4" required minlength="2" placeholder="写下具体经验或问题，不发布客户隐私。"></textarea><label><input type="checkbox" name="ack" required><span>我确认回复内容真实、可分享。</span></label><button type="submit">发布回复 ↗</button></form></div>${ownPostIds.includes(post.id)?`<div class="own-post-actions"><button type="button" id="delete-my-post">删除我发布的内容</button></div><div class="delete-confirm" id="delete-confirm" hidden>确认删除这条内容和所有回复？此操作无法撤销。<br><button type="button" id="confirm-delete">确认删除</button><button type="button" class="cancel" id="cancel-delete">取消</button></div>`:''}`;
}
function openPost(id){currentPostId=id;renderPostDetail();$('#post-dialog').showModal();}
function openCompose(){const form=$('#compose-form');form.reset();form.elements.author.value=profile.name||'';form.elements.province.value=[profile.province,profile.city].filter(Boolean).join('')||'';$('#compose-counter').textContent='0 / 6000 字';$('#compose-dialog').showModal();}
async function api(url,method,data){
  if(communityLocalMode){
    if(method==='POST'&&url==='/api/community/posts'){
      if(!data.author||!data.title||String(data.body||'').length<20||!data.ack)throw new Error('请填好称呼、标题和至少 20 字正文。');
      const post={id:crypto.randomUUID(),kind:data.kind,category:data.category,title:String(data.title).slice(0,90),body:String(data.body).slice(0,6000),author:String(data.author).slice(0,24),province:String(data.province||'').slice(0,24),createdAt:new Date().toISOString(),replies:[]};
      posts.unshift(post);saveLocalPosts();return {post};
    }
    const reply=/^\/api\/community\/posts\/([a-f0-9-]{36})\/replies$/.exec(url);
    if(method==='POST'&&reply){const post=posts.find(x=>x.id===reply[1]);if(!post)throw new Error('帖子不存在。');if(!data.author||String(data.body||'').length<2||!data.ack)throw new Error('请填写称呼和回复内容。');const item={id:crypto.randomUUID(),author:String(data.author).slice(0,24),body:String(data.body).slice(0,1200),createdAt:new Date().toISOString()};post.replies.push(item);saveLocalPosts();return {reply:item};}
    const remove=/^\/api\/community\/posts\/([a-f0-9-]{36})$/.exec(url);
    if(method==='DELETE'&&remove){if(!ownPostIds.includes(remove[1]))throw new Error('仅原发布浏览器可以删除此帖。');posts=posts.filter(x=>x.id!==remove[1]);saveLocalPosts();return {ok:true};}
    throw new Error('社区操作暂时不可用。');
  }
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败');return result;
}

renderGuides();loadPosts();
document.addEventListener('click',event=>{const button=event.target.closest('[data-academy-track]');if(!button)return;activeAcademyTrack=button.dataset.academyTrack;renderGuides();$('#academy-course-heading').scrollIntoView({behavior:'smooth',block:'start'});});
$('#guide-grid').addEventListener('click',event=>{const button=event.target.closest('[data-article]');if(button)openArticle(button.dataset.article);});
document.addEventListener('click',event=>{if(event.target.closest('[data-compose]')||event.target.id==='header-compose')openCompose();});
$$('[data-close]').forEach(button=>button.addEventListener('click',()=>$('#'+button.dataset.close).close()));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();}));
$$('[data-kind]').forEach(button=>button.addEventListener('click',()=>{activeKind=button.dataset.kind;$$('[data-kind]').forEach(item=>item.classList.toggle('active',item===button));renderPosts();}));
$$('[data-category]').forEach(button=>button.addEventListener('click',()=>{activeCategory=button.dataset.category;$$('[data-category]').forEach(item=>item.classList.toggle('active',item===button));renderPosts();}));
$('#post-list').addEventListener('click',event=>{const button=event.target.closest('[data-post]');if(button)openPost(button.dataset.post);});
$('#compose-form').elements.body.addEventListener('input',event=>$('#compose-counter').textContent=`${event.target.value.length} / 6000 字`);
$('#compose-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=$('#publish-button'),data=new FormData(form);
  button.disabled=true;button.textContent='发布中…';
  try{
    const result=await api('/api/community/posts','POST',{ownerToken,ack:data.get('ack')==='on',kind:data.get('kind'),category:data.get('category'),author:data.get('author'),province:data.get('province'),title:data.get('title'),body:data.get('body')});
    ownPostIds.push(result.post.id);window.zdxStorage.local.setItem(ownPostsKey,JSON.stringify(ownPostIds));
    $('#compose-dialog').close();activeKind='all';activeCategory='all';$$('[data-kind]').forEach(item=>item.classList.toggle('active',item.dataset.kind==='all'));$$('[data-category]').forEach(item=>item.classList.toggle('active',item.dataset.category==='all'));
    await loadPosts();$('#discussions').scrollIntoView({behavior:'smooth'});toast(result.post.status==='pending'?'已提交审核，审核通过后公开':'内容已发布到本浏览器演示社区');
  }catch(error){toast(error.message);}finally{button.disabled=false;button.textContent='发布内容 ↗';}
});
$('#post-content').addEventListener('submit',async event=>{
  if(event.target.id!=='reply-form')return;event.preventDefault();const form=new FormData(event.target),button=event.target.querySelector('button[type=submit]');button.disabled=true;
  try{await api(`/api/community/posts/${currentPostId}/replies`,'POST',{author:form.get('author'),body:form.get('body'),ack:form.get('ack')==='on'});await loadPosts();renderPostDetail();toast('回复已发布');}catch(error){toast(error.message);}finally{button.disabled=false;}
});
$('#post-content').addEventListener('click',async event=>{
  if(event.target.id==='delete-my-post'){$('#delete-confirm').hidden=false;return;}
  if(event.target.id==='cancel-delete'){$('#delete-confirm').hidden=true;return;}
  if(event.target.id==='confirm-delete'){
    event.target.disabled=true;
    try{await api(`/api/community/posts/${currentPostId}`,'DELETE',{ownerToken});ownPostIds=ownPostIds.filter(id=>id!==currentPostId);window.zdxStorage.local.setItem(ownPostsKey,JSON.stringify(ownPostIds));$('#post-dialog').close();await loadPosts();toast('内容已删除');}catch(error){toast(error.message);}finally{event.target.disabled=false;}
  }
});
