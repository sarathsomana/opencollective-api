import { expect } from 'chai';

import { roles } from '../../../../server/constants';
import { canDownloadInvoice, canRefund } from '../../../../server/graphql/common/transactions';
import { fakeCollective, fakeOrder, fakeTransaction, fakeUser } from '../../../test-helpers/fake-data';
import { makeRequest } from '../../../utils';

describe('server/graphql/common/transactions', () => {
  let collective, collectiveAdmin, hostAdmin, contributor, randomUser, transaction;
  let publicReq, randomUserReq, collectiveAdminReq, hostAdminReq, rootAdminReq, contributorReq;

  before(async () => {
    randomUser = await fakeUser();
    collectiveAdmin = await fakeUser();
    hostAdmin = await fakeUser();
    const order = await fakeOrder();
    const rootAdmin = await fakeUser();
    contributor = await fakeUser();
    collective = await fakeCollective();
    transaction = await fakeTransaction({
      CollectiveId: collective.id,
      FromCollectiveId: contributor.CollectiveId,
      amount: 100000,
      OrderId: order.id,
    });
    console.log(transaction.OrderId);
    await collective.addUserWithRole(collectiveAdmin, 'ADMIN');
    await collective.host.addUserWithRole(hostAdmin, 'ADMIN');

    await collectiveAdmin.populateRoles();
    await hostAdmin.populateRoles();
    await rootAdmin.populateRoles();

    rootAdmin.rolesByCollectiveId[1] = [roles.ADMIN];

    publicReq = makeRequest();
    randomUserReq = makeRequest(randomUser);
    collectiveAdminReq = makeRequest(collectiveAdmin);
    hostAdminReq = makeRequest(hostAdmin);
    rootAdminReq = makeRequest(rootAdmin);
    contributorReq = makeRequest(contributor);
  });

  describe('canRefund', () => {
    it('can refund if root or host admin of the collective receiving the contribution', async () => {
      expect(await canRefund(transaction, undefined, publicReq)).to.be.false;
      expect(await canRefund(transaction, undefined, randomUserReq)).to.be.false;
      expect(await canRefund(transaction, undefined, collectiveAdminReq)).to.be.false;
      expect(await canRefund(transaction, undefined, contributorReq)).to.be.false;
      expect(await canRefund(transaction, undefined, hostAdminReq)).to.be.true;
      expect(await canRefund(transaction, undefined, rootAdminReq)).to.be.true;
    });
  });

  describe('canDownloadInvoice', () => {
    it('can download invoice if donator or host admin of the collective receiving the contribution', async () => {
      expect(await canDownloadInvoice(transaction, undefined, publicReq)).to.be.false;
      expect(await canDownloadInvoice(transaction, undefined, randomUserReq)).to.be.false;
      expect(await canDownloadInvoice(transaction, undefined, collectiveAdminReq)).to.be.false;
      expect(await canDownloadInvoice(transaction, undefined, contributorReq)).to.be.true;
      expect(await canDownloadInvoice(transaction, undefined, hostAdminReq)).to.be.true;
      expect(await canDownloadInvoice(transaction, undefined, rootAdminReq)).to.be.false;
    });
  });
});
