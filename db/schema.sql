-- ============================================================
-- db/schema.sql — Day 16 建表脚本
-- 两张表：posts（帖子本体）/ comments（评论）
-- 关联：comments.post_id -> posts.id（一对多）
-- 特性：可重复执行不报错（CREATE TABLE IF NOT EXISTS）
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
