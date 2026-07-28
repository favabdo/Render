// utils/timing.js
// أداة قياس زمن حقيقي (process.hrtime.bigint) لكل مرحلة في مسار "بعت رد" —
// مصممة عشان تتحط في أي request وتتنقل بين middleware/controller/service بدون
// ما تغيّر أي حاجة في المنطق أو الاستجابة نفسها. كل نداء لـ .mark(label) بيسجل:
// - stepMs: الوقت من آخر مرحلة لحد دلوقتي
// - totalMs: الوقت من أول مرحلة (بداية الـ request) لحد دلوقتي
// التقرير النهائي بيتطبع في اللوج دايمًا (logger.info)، وممكن كمان يترجع في
// جسم الاستجابة نفسها بس لو طلب المستخدم صراحة (هيدر أو env flag) — شوف
// requestTiming middleware و attachTimingToResponse تحت.

function nowNs() {
  return process.hrtime.bigint();
}

function msSince(startNs, endNs) {
  return Math.round(Number(endNs - startNs) / 1e4) / 100; // 2 decimal places
}

function createTimer() {
  const start = nowNs();
  let last = start;
  const marks = [];

  function mark(label) {
    const now = nowNs();
    const entry = {
      label,
      stepMs: msSince(last, now),
      totalMs: msSince(start, now),
    };
    marks.push(entry);
    last = now;
    return entry;
  }

  // لمرحلة async بتتنفذ ممكن تكون بالتوازي مع مراحل تانية (زي جوه Promise.all) —
  // .mark() العادية بتفترض ترتيب تسلسلي (كل مرحلة بعد اللي قبلها)، فمش تناسب
  // قياس عمليتين شغالين في نفس الوقت. .time() بتسجل بداية/نهاية العملية دي هي
  // نفسها بالظبط (مش نسبي لآخر مرحلة)، فبترجع المدة الحقيقية بغض النظر عن أي
  // حاجة تانية شغالة معاها في نفس اللحظة.
  async function time(label, promiseOrFn) {
    const stepStart = nowNs();
    try {
      const result = typeof promiseOrFn === 'function' ? await promiseOrFn() : await promiseOrFn;
      const now = nowNs();
      marks.push({ label, stepMs: msSince(stepStart, now), totalMs: msSince(start, now) });
      return result;
    } catch (err) {
      const now = nowNs();
      marks.push({ label: `${label}:error`, stepMs: msSince(stepStart, now), totalMs: msSince(start, now) });
      throw err;
    }
  }

  function elapsedMs() {
    return msSince(start, nowNs());
  }

  function report(event) {
    return { event, totalMs: elapsedMs(), stages: marks.map((m) => ({ ...m })) };
  }

  return { mark, time, marks, elapsedMs, report, start };
}

module.exports = { createTimer, nowNs, msSince };
