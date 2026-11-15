-- Demo data. Run once on a fresh database to try the tool; skip in production
-- (or delete these rows from the Settings screen afterwards).
INSERT INTO campaigns (name, start_date, end_date, goal, color, status) VALUES
  ('إطلاق محصول الموسم', '2026-11-01', '2026-11-30', 'تعريف المتابعين بالمحصول الجديد وزيادة الطلب المسبق', '#b5562b', 'active'),
  ('شهر V60', '2026-11-10', '2026-12-10', 'محتوى تعليمي عن التقطير ورفع مبيعات أدوات التحضير', '#2f6f5e', 'active'),
  ('الجمعة البيضاء', '2026-11-20', '2026-11-29', 'عروض الجمعة البيضاء', '#3b4a8a', 'planned');

INSERT INTO products (name, origin, process, status) VALUES
  ('إثيوبيا قوجي', 'إثيوبيا', 'مغسول', 'available'),
  ('كولومبيا هويلا', 'كولومبيا', 'مجفف', 'available'),
  ('اليمن حراز', 'اليمن', 'طبيعي', 'available'),
  ('كينيا نيري', 'كينيا', 'مغسول', 'sold_out');

INSERT INTO tools (name, category) VALUES
  ('V60', 'تقطير'),
  ('كيمكس', 'تقطير'),
  ('أيروبريس', 'ضغط'),
  ('مطحنة يدوية', 'طحن'),
  ('ميزان قهوة', 'قياس');

INSERT INTO posts (title, caption, platform, format, planned_at, campaign_id, owner_email, status, published_at, post_url) VALUES
  ('ريل: من المزرعة للكوب — قوجي', 'رحلة محصول قوجي من إثيوبيا لين كوبك ☕', 'instagram', 'reel', '2026-11-02T19:00', 1, 'demo@example.com', 'published', '2026-11-02T19:05', 'https://instagram.com/p/demo1'),
  ('ستوري: تصويت أي محصول تبون؟', NULL, 'instagram', 'story', '2026-11-03T20:00', 1, 'demo@example.com', 'published', '2026-11-03T20:10', NULL),
  ('تيك توك: تحضير قوجي على V60', NULL, 'tiktok', 'video', '2026-11-05T21:00', 2, 'demo@example.com', 'published', '2026-11-05T21:00', 'https://tiktok.com/@demo/video/1'),
  ('سناب: جولة في المحمصة', NULL, 'snapchat', 'story', '2026-11-06T18:00', NULL, 'demo@example.com', 'published', '2026-11-06T18:30', NULL),
  ('كاروسيل: الفرق بين كيمكس وV60', NULL, 'instagram', 'carousel', '2026-11-12T19:00', 2, 'demo@example.com', 'review', NULL, NULL),
  ('ريل: هويلا بالأيروبريس', NULL, 'instagram', 'reel', '2026-11-14T19:00', 1, 'demo@example.com', 'design', NULL, NULL),
  ('تيك توك: عرض الجمعة البيضاء', NULL, 'tiktok', 'video', '2026-11-21T20:00', 3, 'demo@example.com', 'idea', NULL, NULL),
  ('سبوتلايت: نسبة الماء للقهوة', NULL, 'snapchat', 'spotlight', '2026-11-16T17:00', 2, 'demo@example.com', 'scheduled', NULL, NULL);

INSERT INTO post_products (post_id, product_id) VALUES (1, 1), (2, 1), (2, 2), (2, 3), (3, 1), (6, 2);
INSERT INTO post_tools (post_id, tool_id) VALUES (3, 1), (3, 5), (5, 1), (5, 2), (6, 3), (8, 5);

INSERT INTO team_members (email, name, role) VALUES ('demo@example.com', 'حساب تجريبي', 'admin');
