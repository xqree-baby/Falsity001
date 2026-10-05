-- ============================================================
-- db/schema.sql — 建表脚本（Day 16 首建，Day 17 追加两张表）
-- 四张表：posts（帖子）/ comments（评论）/ trends（热搜）/ favorites（收藏）
-- 关联：comments.post_id -> posts.id（一对多）
--       favorites.post_id -> posts.id（一对多：一篇帖子可被多人收藏）
-- 特性：可重复执行不报错（CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS）
-- 数据库：PostgreSQL（CloudBase 控制台「SQL 型数据库 > PostgreSQL 管理」）
--   已按 PG 定稿：时间戳用 TIMESTAMPTZ（带时区，存 +08:00 不失真）
--   schema：public（CloudBase 默认，也是可用于 REST API 访问的那个）
-- ============================================================

-- 帖子表：一行 = 一篇帖子（观点或提问）
CREATE TABLE IF NOT EXISTS posts (
  id              VARCHAR(16)  PRIMARY KEY,               -- 帖子编号，如 p001（沿用现有数据，不用自增数字）
  type            VARCHAR(16)  NOT NULL,                  -- 帖子类型：opinion=观点 / question=提问
  category        VARCHAR(32)  NOT NULL DEFAULT '未分类',  -- 分类：求职面试/职场新人/人际沟通/薪资福利/晋升发展/劳动权益
  title           VARCHAR(200) NOT NULL,                  -- 标题（短、有上限，适合 VARCHAR）
  body            TEXT         NOT NULL,                  -- 正文（长短悬殊，TEXT 不限长度）
  author          VARCHAR(64)  NOT NULL,                  -- 作者昵称
  author_verified BOOLEAN      NOT NULL DEFAULT FALSE,    -- 作者是否公司认证用户
  pending         BOOLEAN      NOT NULL DEFAULT TRUE,     -- 是否待审核（true 时前台不显示）
  views           INTEGER      NOT NULL DEFAULT 0,        -- 浏览量（整数计数）
  created_at      TIMESTAMPTZ  NOT NULL,                  -- 发布时间（带时区，PG 推荐写法）
  CONSTRAINT posts_type_check CHECK (type IN ('opinion', 'question'))  -- 数据库层挡住非法类型
);

-- 评论表：一行 = 一条评论，靠 post_id 挂到某篇帖子上
CREATE TABLE IF NOT EXISTS comments (
  id         VARCHAR(16) PRIMARY KEY,                     -- 评论编号，如 c001
  post_id    VARCHAR(16) NOT NULL,                        -- ★ 关联字段：指向 posts.id
  author     VARCHAR(64) NOT NULL,                        -- 评论者昵称
  body       TEXT        NOT NULL,                        -- 评论内容
  created_at TIMESTAMPTZ NOT NULL,                        -- 评论时间
  CONSTRAINT comments_post_fk
    FOREIGN KEY (post_id) REFERENCES posts(id)            -- 外键：评论不能指向不存在的帖子
);

-- ------------------------------------------------------------
-- 以下两张表为 Day 17 追加（GET 读接口 + 热搜同步用）
-- 不动上面 posts / comments 的结构，只是新增
-- ------------------------------------------------------------

-- 热搜表：一行 = 某平台某天的一条热搜词条
-- 主键直接用业务天然键（platform + title + date）三列组合，
--   不另造自增 id —— 这三列本身就能唯一确定一条热搜，
--   且 /api/sync 的判重 ON CONFLICT (platform, title, date) 用的就是它
-- ⚠️ 判重边界（Day 17 实测踩到）：主键只认「平台+标题+日期」完全相同才算重复。
--   热搜榜是实时变动的：两次抓取之间榜单会洗牌，昨天第 30 名的词条今天可能掉出
--   前 30、换成一个新词条进来，而两者标题不同 → 判重拦不住，会在同一天留下两行。
--   所以「重复同步总行数不变」只在榜单稳定时成立；要严格去重需按 (platform,date)
--   先删当日行再整批插入（Day 18 再定）。
CREATE TABLE IF NOT EXISTS trends (
  platform   VARCHAR(16)  NOT NULL,                     -- 来源平台：weibo / bilibili / douyin
  title      TEXT         NOT NULL,                     -- 热搜词条文本
  hot        BIGINT       NOT NULL DEFAULT 0,           -- 热度值（各平台口径不同，仅展示用）
  rank       INTEGER      NOT NULL,                     -- 平台内排名，1 开始（B站无此字段，用数组下标+1 补）
  date       DATE         NOT NULL,                     -- 榜单日期（北京时间，不是 UTC！）
  fetched_at TIMESTAMPTZ  NOT NULL DEFAULT now(),       -- 最近一次抓取时间
  PRIMARY KEY (platform, title, date)                   -- 组合主键 = 判重唯一索引
);

-- 查询索引：/api/hot 按日期查、组内按排名排，走这个索引不用全表扫
CREATE INDEX IF NOT EXISTS trends_date_rank_idx ON trends (date, platform, rank);

-- 收藏表：一行 = 一条收藏记录（Day 17 只读，写入接口 Day 18 做）
CREATE TABLE IF NOT EXISTS favorites (
  id         VARCHAR(16)  PRIMARY KEY,                  -- 收藏编号，如 f001
  post_id    VARCHAR(16)  NOT NULL,                     -- ★ 关联字段：指向 posts.id
  created_at TIMESTAMPTZ  NOT NULL,                     -- 收藏时间（接口里返回为 savedAt）
  CONSTRAINT favorites_post_fk
    FOREIGN KEY (post_id) REFERENCES posts(id)          -- 外键：不能收藏不存在的帖子
);
