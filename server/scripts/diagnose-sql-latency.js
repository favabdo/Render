// scripts/diagnose-sql-latency.js
//
// تشخيص مستقل تمامًا عن أي منطق تطبيق — بيقيس 3 حاجات منفصلة عشان نعرف السبب
// الحقيقي وراء الـ ~340ms اللي ظاهرة في تقرير reply flow:
//
//  1) وقت أول اتصال (pool warm-up) — مرة واحدة بس
//  2) متوسط round-trip حقيقي لاستعلام تافه (SELECT 1، تنفيذه على السيرفر
//     تقريبًا صفر) — ده أقرب حاجة لقياس "شبكة + بروتوكول" لوحدهم من غير أي
//     تكلفة استعلام حقيقية تتداخل مع الرقم
//  3) هل استعلامين "متزامنين" (Promise.all) بيتنفذوا فعليًا في نفس الوقت
//     (concurrent) ولا بيصطفوا (serialize) — ده بالظبط نفس الشك اللي طلع من
//     بيانات الـ reply flow الحقيقية
//
// تشغيل: node scripts/diagnose-sql-latency.js
// (لازم متغيرات DB_* في .env مظبوطة زي التطبيق بالظبط)

const { getPool, sql } = require('../src/database/connection');

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

async function pingOnce(pool) {
  const t0 = nowMs();
  await pool.request().query('SELECT 1 AS ping');
  return nowMs() - t0;
}

async function main() {
  console.log('== 1) وقت أول اتصال (pool warm-up) ==');
  const connectStart = nowMs();
  const pool = await getPool();
  console.log(`اتصال أول مرة: ${(nowMs() - connectStart).toFixed(2)}ms`);

  console.log('\n== 2) متوسط round-trip حقيقي (10x SELECT 1 متتالية، sequential) ==');
  const sequentialTimes = [];
  for (let i = 0; i < 10; i++) {
    sequentialTimes.push(await pingOnce(pool));
  }
  const avg = sequentialTimes.reduce((a, b) => a + b, 0) / sequentialTimes.length;
  const min = Math.min(...sequentialTimes);
  const max = Math.max(...sequentialTimes);
  console.log('كل محاولة (ms):', sequentialTimes.map((t) => t.toFixed(2)).join(', '));
  console.log(`متوسط: ${avg.toFixed(2)}ms | أقل: ${min.toFixed(2)}ms | أعلى: ${max.toFixed(2)}ms`);
  console.log(
    min > 50
      ? '⚠️ حتى SELECT 1 (تنفيذ شبه صفري) بتاخد وقت محسوس — يبقى المشكلة في الشبكة/البروتوكول مش في تكلفة أي استعلام حقيقي.'
      : '✅ SELECT 1 سريع — لو استعلامات التطبيق الحقيقية لسه بطيئة، المشكلة في الاستعلام نفسه مش في الشبكة.'
  );

  console.log('\n== 3) هل استعلامين متزامنين فعليًا بيتنفذوا مع بعض ولا بيصطفوا؟ (5 أزواج) ==');
  for (let i = 0; i < 5; i++) {
    const pairStart = nowMs();
    const [a, b] = await Promise.all([pingOnce(pool), pingOnce(pool)]);
    const pairTotal = nowMs() - pairStart;
    const parallel = pairTotal < a + b * 0.7; // لو الاتنين اشتغلوا مع بعض فعلاً، المجموع الكلي المفروض يقرب من أبطأهم لوحده مش مجموعهم
    console.log(
      `زوج #${i + 1}: query A=${a.toFixed(2)}ms, query B=${b.toFixed(2)}ms, الوقت الكلي للزوج=${pairTotal.toFixed(2)}ms → ${
        parallel ? '✅ اشتغلوا بالتوازي فعليًا' : '⚠️ يبدو إنهم اصطفوا (serialized) بدل ما يشتغلوا مع بعض'
      }`
    );
  }

  console.log(
    '\nملحوظة: لو ظهر "new_connection_opened" في لوج السيرفر مع كل رد بتبعته من الداشبورد (مش مرة أو مرتين بس عند الإقلاع)،\n' +
    'يبقى فعليًا بيتفتح كونكشن جديد بدل ما يترجع نفس الكونكشن — دي أقوى دليل على مشكلة فعلية في الـ pooling.'
  );

  await sql.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ فشل التشخيص:', err.message);
  process.exit(1);
});
