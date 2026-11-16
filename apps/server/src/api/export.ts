import { PlanTree, isLanguage, localized, minutesToDays, totalOf, type Language } from '@spm/shared';
import ExcelJS from 'exceljs';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { planVersions, projectRoles } from '../db/schema.js';
import { translator } from '../i18n.js';
import { notFound } from './errors.js';
import { context, payload, workingVersion } from './plan.js';

const days = (min: number | undefined) => (min ? minutesToDays(min) : null);

/**
 * The plan with its effort estimation as an Excel file, in the project language (or ?lang=). It contains
 * exactly what the user may see in the app.
 */
export async function exportRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get<{ Params: { id: string }; Querystring: { version?: string; lang?: string } }>(
    '/api/projects/:id/plan/export.xlsx',
    async (request, reply) => {
      const ctx = await context(db, request.user, request.params.id);
      let version;
      if (request.query.version) {
        [version] = await db
          .select()
          .from(planVersions)
          .where(and(eq(planVersions.id, request.query.version), eq(planVersions.projectId, ctx.rootId)));
        if (!version) throw notFound();
      } else version = await workingVersion(db, ctx.rootId, request.user.id);
      const plan = await payload(db, request.user, ctx, version);
      const lang: Language = isLanguage(request.query.lang) ? request.query.lang : ctx.root.language;
      const t = translator(lang);
      const roles = new Map((await db.select().from(projectRoles)).map((r) => [r.id, r]));
      const roleName = (id: string) => localized(roles.get(id)?.names, lang);
      const effort = plan.effort;
      const roleIds = effort?.roleIds ?? [];
      const slimstock = new Set(roleIds.filter((r) => roles.get(r)?.side === 'slimstock'));
      const customer = new Set(roleIds.filter((r) => roles.get(r)?.side === 'customer'));

      const wb = new ExcelJS.Workbook();
      wb.creator = 'Slimstock Projektmanagement';
      const bold = { font: { bold: true } };

      // Sheet 1: tasks with dates and effort per role.
      const ws = wb.addWorksheet(t('export.sheetPlan'));
      const header = [
        t('plan.col.name'),
        t('plan.col.start'),
        t('plan.col.end'),
        t('plan.col.progress'),
        // Role names repeat on both sides (Projektleiter): customer columns say so.
        ...roleIds.map((id) => (customer.has(id) ? `${roleName(id)} (${t('side.customer')})` : roleName(id))),
        t('export.sumSlimstock'),
        t('export.sumCustomer'),
        ...(effort?.withActual ? [t('effort.actual'), t('effort.remaining'), t('effort.forecast')] : []),
      ];
      ws.addRow([`${plan.project.name} – V${plan.version.no}${plan.version.name ? ` ${plan.version.name}` : ''}`]).font = {
        bold: true,
        size: 14,
      };
      ws.addRow([t('export.unit')]).font = { italic: true, color: { argb: 'FF6B7280' } };
      ws.addRow([]);
      const head = ws.addRow(header);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF354157' } }));
      const tree = new PlanTree(plan.items, plan.subprojects, plan.project.id);
      for (const r of tree.rows) {
        const c = plan.computed[r.id];
        const e = effort?.byRow[r.id];
        const name = r.kind === 'subproject' ? r.sub.name : r.item.title;
        const row = ws.addRow([
          `${'   '.repeat(r.depth)}${name}`,
          c ? new Date(`${c.start}T00:00:00Z`) : null,
          c ? new Date(`${c.end}T00:00:00Z`) : null,
          c ? c.progress / 100 : null,
          ...roleIds.map((id) => days(e?.plan[id])),
          days(e && totalOf(e.plan, slimstock)),
          days(e && totalOf(e.plan, customer)),
          ...(effort?.withActual
            ? [
                days(e && totalOf(e.actual, slimstock)),
                days(e && totalOf(e.remaining, slimstock)),
                days(e && totalOf(e.forecast, slimstock)),
              ]
            : []),
        ]);
        if (r.summary) row.font = { bold: true };
      }
      if (effort) {
        const total = ws.addRow([
          t('effort.total'),
          null,
          null,
          null,
          ...roleIds.map((id) => days(effort.total.plan[id])),
          days(totalOf(effort.total.plan, slimstock)),
          days(totalOf(effort.total.plan, customer)),
          ...(effort.withActual
            ? [
                days(totalOf(effort.total.actual, slimstock)),
                days(totalOf(effort.total.remaining, slimstock)),
                days(totalOf(effort.total.forecast, slimstock)),
              ]
            : []),
        ]);
        total.font = { bold: true };
        total.border = { top: { style: 'thin' } };
      }
      ws.getColumn(1).width = 46;
      ws.getColumn(2).numFmt = lang === 'en' ? 'yyyy-mm-dd' : 'dd.mm.yyyy';
      ws.getColumn(3).numFmt = ws.getColumn(2).numFmt;
      ws.getColumn(2).width = ws.getColumn(3).width = 12;
      ws.getColumn(4).numFmt = '0%';
      for (let i = 5; i <= header.length; i++) {
        ws.getColumn(i).width = 14;
        ws.getColumn(i).numFmt = '0.##';
      }
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];

      // Sheet 2: budget per billing unit (Slimstock days).
      if (effort?.budgets.length) {
        const bs = wb.addWorksheet(t('export.sheetBudget'));
        bs.addRow([
          t('export.unitName'),
          t('effort.billingLabel'),
          t('effort.budget'),
          t('effort.plan'),
          t('effort.actual'),
          t('effort.remaining'),
          t('effort.forecast'),
          t('effort.deviation'),
        ]).eachCell((c) => Object.assign(c, bold));
        for (const b of effort.budgets) {
          const name =
            b.unitId === plan.project.id ? t('effort.projectLevel') : (plan.subprojects.find((s) => s.id === b.unitId)?.name ?? '');
          bs.addRow([
            name,
            t(`effort.billing.${b.billing}`),
            days(b.budget),
            days(b.plan),
            days(b.actual),
            days(b.remaining),
            days(b.forecast),
            days(b.deviation),
          ]);
        }
        bs.getColumn(1).width = 36;
        for (let i = 2; i <= 8; i++) bs.getColumn(i).width = 14;
      }

      // Sheet 3: bookings.
      if (effort?.entries.length) {
        const es = wb.addWorksheet(t('export.sheetEntries'));
        es.addRow([
          t('effort.date'),
          t('plan.col.name'),
          t('effort.person'),
          t('effort.role'),
          t('effort.days'),
          t('effort.note'),
        ]).eachCell((c) => Object.assign(c, bold));
        const titleOf = new Map(plan.items.map((i) => [i.key, i.title]));
        for (const e of effort.entries) {
          es.addRow([
            new Date(`${e.date}T00:00:00Z`),
            titleOf.get(e.itemKey) ?? '?',
            e.userName,
            roleName(e.roleId),
            minutesToDays(e.minutes),
            e.note ?? '',
          ]);
        }
        es.getColumn(1).numFmt = ws.getColumn(2).numFmt;
        es.getColumn(1).width = 12;
        es.getColumn(2).width = 40;
        es.getColumn(3).width = es.getColumn(4).width = 22;
        es.getColumn(6).width = 40;
      }

      const buffer = await wb.xlsx.writeBuffer();
      const name = `${plan.project.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_V${plan.version.no}.xlsx`;
      // ASCII fallback plus the real name (RFC 5987) – headers cannot carry umlauts directly.
      const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`)
        .send(Buffer.from(buffer));
    },
  );
}
