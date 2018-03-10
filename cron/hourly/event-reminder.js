import Promise from 'bluebird';
import models from '../../server/models';
import emailLib from '../../server/lib/email';
import { get } from 'lodash';

let totalEvents = 0;

const XDaysAgo = (days) => {
  const d = new Date;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days);
}

Date.prototype.toString = function() {
  const mm = this.getMonth() + 1; // getMonth() is zero-based
  const dd = this.getDate();
  const hours = this.getHours();
  const minutes = this.getMinutes();

  return `${[this.getFullYear(),
          (mm>9 ? '' : '0') + mm,
          (dd>9 ? '' : '0') + dd
         ].join('-')} ${hours > 9 ? hours : `${hours}0`}:${minutes}`;
};

const nextWeekStartsAt = new Date;
nextWeekStartsAt.setDate(nextWeekStartsAt.getDate() + 7);
const nextWeekEndsAt = new Date(nextWeekStartsAt);
nextWeekEndsAt.setHours(nextWeekEndsAt.getHours() + 1);

const tomorrowStartsAt = new Date;
tomorrowStartsAt.setDate(tomorrowStartsAt.getDate() + 1);
const tomorrowEndsAt = new Date(tomorrowStartsAt);
tomorrowEndsAt.setHours(tomorrowStartsAt.getHours() + 1);

if (process.env.DEBUG) {
  tomorrowEndsAt.setFullYear(tomorrowEndsAt.getFullYear()+1);
  nextWeekEndsAt.setFullYear(nextWeekEndsAt.getFullYear()+1);
}
console.log(">>> Fetching all events that start within time range", tomorrowStartsAt.toString(), tomorrowEndsAt.toString());

models.Collective.findAll({ where: {
  type: "EVENT",
  startsAt: { $gte: tomorrowStartsAt, $lt: tomorrowEndsAt }
}})
.tap(events => {
  console.log(`>>> Processing ${events.length} events`);
})
.map(event => processEvent(event, "event.reminder.1d"))
.then(() => {
  console.log(">>> Fetching all events that start within time range", nextWeekStartsAt.toString(), nextWeekEndsAt.toString());
  return models.Collective.findAll({
    where: {
      type: "EVENT",
      startsAt: { $gte: nextWeekStartsAt, $lt: nextWeekEndsAt }
    }
  })
})
.map(event => processEvent(event, "event.reminder.7d"))
.then(() => {
  console.log("All done");
  process.exit(0);
});

function processEvent(event, template) {
  totalEvents++;

  console.log(">>> processing", event.slug);
  return models.Order.findAll({
    where: { CollectiveId: event.id },
    include: [ { model: models.Collective, as: 'fromCollective' } ]
  })
  .tap(orders => {
    console.log(`Processing ${orders.length} orders`);
  })
  .map(async (order) => {
    const user = await models.User.findOne({ where: { CollectiveId: get(order, 'fromCollective.id') } });
    event.path = await event.getUrlPath();
    const recipient = user.email;
    const data = {
      collective: event,
      order
    }
    return emailLib.send(template, recipient, data).catch(e => {
      console.warn("Unable to send email to ", event.slug, recipient, "error:", e);
    });
  })
}