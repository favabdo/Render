-- شغّل السكريبت ده مرة واحدة على قاعدة بياناتك (SQL Server) قبل ما تنشر
-- التعديلات الجديدة. بيضيف الأعمدة اللازمة لتخزين إيميل/باسورد شات ووت
-- (بديل التوكن) على مستوى الاتصال العام وعلى مستوى كل إيجنت لوحده.
-- آمن يتشغل أكتر من مرة (بيتأكد الأول إن العمود مش موجود خلاص).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.External_Provider_byA') AND name = 'login_email'
)
BEGIN
  ALTER TABLE [dbo].[External_Provider_byA] ADD login_email NVARCHAR(200) NULL;
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.External_Provider_byA') AND name = 'login_password'
)
BEGIN
  ALTER TABLE [dbo].[External_Provider_byA] ADD login_password NVARCHAR(500) NULL;
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.External_Agent_byA') AND name = 'agent_email'
)
BEGIN
  ALTER TABLE [dbo].[External_Agent_byA] ADD agent_email NVARCHAR(200) NULL;
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.External_Agent_byA') AND name = 'agent_password'
)
BEGIN
  ALTER TABLE [dbo].[External_Agent_byA] ADD agent_password NVARCHAR(500) NULL;
END
