/* -------------------------------------------------------------------------
   VENDOR WRAPPER — dayjs + Chart.js, bundled locally (no CDN needed)
   ------------------------------------------------------------------------- */
import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear.js'
import isoWeek from 'dayjs/plugin/isoWeek.js'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(weekOfYear)
dayjs.extend(isoWeek)
dayjs.extend(isSameOrBefore)
dayjs.extend(isSameOrAfter)
dayjs.extend(customParseFormat)

export default dayjs
