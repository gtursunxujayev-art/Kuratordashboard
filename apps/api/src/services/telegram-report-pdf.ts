import puppeteer from 'puppeteer';
import type { CourseMatrixSection, KuratorSummaryRow, PeriodRange, TenantReport } from './telegram-reports';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPoints(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '-';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function renderKuratorRows(rows: KuratorSummaryRow[]): string {
  if (rows.length === 0) {
    return `<tr><td colspan="6" class="empty">No kurator data</td></tr>`;
  }
  return rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td class="num">${row.studentCount}</td>
        <td class="num">${row.completedTasks}</td>
        <td class="num">${row.pendingTasks}</td>
        <td class="num">${row.missedStudents}</td>
        <td class="num">${row.performancePercent}%</td>
      </tr>`,
    )
    .join('');
}

function renderKuratorTypeBlock(title: string, rows: KuratorSummaryRow[]): string {
  if (rows.length === 0) {
    return `
      <section class="kurator-type-block">
        <h3 class="course-type-title">${escapeHtml(title)}</h3>
        <div class="empty-card">No ${escapeHtml(title.toLowerCase())} data.</div>
      </section>
    `;
  }

  const totalKurators = rows.length;
  const totalCompleted = rows.reduce((sum, row) => sum + row.completedTasks, 0);
  const totalPending = rows.reduce((sum, row) => sum + row.pendingTasks, 0);
  const totalMissed = rows.reduce((sum, row) => sum + row.missedStudents, 0);

  return `
    <section class="kurator-type-block">
      <h3 class="course-type-title">${escapeHtml(title)}</h3>
      <div class="summary-grid">
        <div class="summary-card"><div class="label">Kuratorlar soni</div><div class="value">${totalKurators}</div></div>
        <div class="summary-card"><div class="label">Bajarilgan vazifalar</div><div class="value">${totalCompleted}</div></div>
        <div class="summary-card"><div class="label">Bajarilmagan vazifalar</div><div class="value">${totalPending}</div></div>
        <div class="summary-card"><div class="label">Kelmagan o'quvchilar</div><div class="value">${totalMissed}</div></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Kurator</th>
            <th>O'quvchilar</th>
            <th>Bajarilgan</th>
            <th>Bajarilmagan</th>
            <th>Kelmagan</th>
            <th>Samaradorlik</th>
          </tr>
        </thead>
        <tbody>${renderKuratorRows(rows)}</tbody>
      </table>
    </section>
  `;
}

function renderCourseSection(section: CourseMatrixSection): string {
  const headerCells = section.practiceNames
    .map((name) => `<th>${escapeHtml(name)}</th>`)
    .join('');

  const rows = section.rows
    .map((student) => {
      const cells = student.practicePoints
        .map((points) => {
          const text = formatPoints(points);
          const className = points > 0 ? 'cell-positive' : 'cell-neutral';
          return `<td class="num ${className}">${text}</td>`;
        })
        .join('');

      return `
        <tr>
          <td class="student-cell">
            <div class="student-name">${escapeHtml(student.studentName)}</div>
          </td>
          ${cells}
          <td class="num total-cell">${formatPoints(student.totalPoints)}</td>
        </tr>`;
    })
    .join('');

  const emptyRow =
    section.rows.length === 0
      ? `<tr><td colspan="${section.practiceNames.length + 2}" class="empty">No students for this course</td></tr>`
      : '';

  return `
    <section class="course-section">
      <h3>${escapeHtml(section.courseName)}</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>O'quvchi</th>
              ${headerCells}
              <th>Jami ball</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            ${emptyRow}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCourseTypeGroup(title: string, sections: CourseMatrixSection[]): string {
  if (sections.length === 0) {
    return `
      <section class="course-type-group">
        <h3 class="course-type-title">${escapeHtml(title)}</h3>
        <div class="empty-card">No ${escapeHtml(title.toLowerCase())} course report data.</div>
      </section>
    `;
  }

  return `
    <section class="course-type-group">
      <h3 class="course-type-title">${escapeHtml(title)}</h3>
      ${sections.map(renderCourseSection).join('')}
    </section>
  `;
}

function renderHtml(report: TenantReport): string {
  const periodLabel = `${report.period.fromLabel} - ${report.period.toLabel}`;
  const generatedLabel = report.generatedAt.toISOString().replace('T', ' ').replace('Z', ' UTC');
  const kuratorSections = `${renderKuratorTypeBlock('Online hisobot', report.kuratorsByType.online)}${renderKuratorTypeBlock('Ofline hisobot', report.kuratorsByType.offline)}`;
  const onlineSections = report.courseSections.filter((section) => section.courseType === 'online');
  const offlineSections = report.courseSections.filter((section) => section.courseType === 'offline');
  const courseSections =
    report.courseSections.length === 0
      ? '<div class="empty-card">No online/offline course report data.</div>'
      : `${renderCourseTypeGroup('Online hisobot', onlineSections)}${renderCourseTypeGroup('Ofline hisobot', offlineSections)}`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root {
      --brand: #8f1143;
      --brand-soft: #f9edf3;
      --border: #d4d9e2;
      --text: #1f2937;
      --muted: #6b7280;
      --positive: #22c55e;
      --surface: #ffffff;
      --header-dark: #203a5f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--text);
      background: #f5f7fb;
      font-size: 11px;
      line-height: 1.4;
      padding: 20px;
    }
    .report {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .top {
      background: var(--brand);
      color: #fff;
      padding: 18px 20px;
    }
    .title {
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 6px;
    }
    .subtitle {
      font-size: 20px;
      margin: 0;
      opacity: .95;
    }
    .meta {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      background: #fff;
      color: var(--header-dark);
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .meta strong { color: var(--text); }
    .section {
      padding: 18px 20px;
      border-bottom: 1px solid var(--border);
    }
    .section-title {
      margin: 0 0 10px;
      background: var(--brand);
      color: #fff;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 700;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .summary-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: #fbfcff;
    }
    .summary-card .label { color: var(--muted); font-size: 10px; }
    .summary-card .value { font-size: 18px; font-weight: 700; color: #225eea; }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
      background: #fff;
      border: 1px solid var(--border);
    }
    th, td {
      border: 1px solid var(--border);
      padding: 6px 7px;
      vertical-align: middle;
    }
    th {
      background: #eef2f8;
      color: #334155;
      font-weight: 700;
      font-size: 10px;
      text-align: left;
    }
    td.num { text-align: center; font-variant-numeric: tabular-nums; }
    .student-cell { min-width: 170px; }
    .student-name { font-weight: 700; color: #0f172a; }
    .cell-positive {
      background: rgba(34, 197, 94, 0.18);
      color: #146534;
      font-weight: 700;
    }
    .cell-neutral {
      background: #f8fafc;
      color: #475569;
    }
    .total-cell {
      background: var(--brand-soft);
      color: #7f123e;
      font-weight: 700;
    }
    .course-section {
      margin-top: 12px;
      page-break-inside: avoid;
    }
    .course-type-group {
      margin-top: 14px;
    }
    .course-type-title {
      margin: 0 0 10px;
      color: #111827;
      font-size: 14px;
      font-weight: 700;
    }
    .kurator-type-block {
      margin-top: 12px;
    }
    .kurator-type-block:first-of-type {
      margin-top: 0;
    }
    .course-section h3 {
      margin: 0 0 8px;
      font-size: 13px;
      color: #111827;
    }
    .table-wrap { overflow: hidden; border-radius: 8px; }
    .empty {
      text-align: center;
      color: var(--muted);
      background: #f8fafc;
      font-style: italic;
    }
    .empty-card {
      border: 1px dashed var(--border);
      border-radius: 8px;
      padding: 14px;
      text-align: center;
      color: var(--muted);
      background: #f9fafb;
    }
    .footer {
      padding: 12px 20px;
      color: var(--muted);
      font-size: 10px;
      background: #fcfcfd;
    }
  </style>
</head>
<body>
  <article class="report">
    <header class="top">
      <h1 class="title">${escapeHtml(report.tenantName)}</h1>
      <p class="subtitle">Kunlik hisobot (${escapeHtml(report.period.kind)})</p>
    </header>
    <section class="meta">
      <div><strong>Davr:</strong> ${escapeHtml(periodLabel)}</div>
      <div><strong>Tayyorlangan:</strong> ${escapeHtml(generatedLabel)}</div>
    </section>
    <section class="section">
      <h2 class="section-title">Kuratorlar kesimida</h2>
      ${kuratorSections}
    </section>
    <section class="section">
      <h2 class="section-title">Hisobot jadvali (faol kurslar)</h2>
      ${courseSections}
    </section>
    <footer class="footer">Generated by Kuratordashboard Telegram report pipeline</footer>
  </article>
</body>
</html>`;
}

export async function renderReportPdf(report: TenantReport): Promise<Buffer> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent(renderHtml(report), { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' },
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export type {
  TenantReport,
  PeriodRange,
  KuratorSummaryRow,
  CourseMatrixSection,
};
