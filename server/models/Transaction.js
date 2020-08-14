import Promise from 'bluebird';
import debugLib from 'debug';
import { defaultsDeep, get, isUndefined } from 'lodash';
import moment from 'moment';
import { v4 as uuid } from 'uuid';

import activities from '../constants/activities';
import { FEES_ON_TOP_TRANSACTION_PROPERTIES, TransactionTypes } from '../constants/transactions';
import { getFxRate } from '../lib/currency';
import { toNegative } from '../lib/math';
import { calcFee } from '../lib/payments';
import { stripHTML } from '../lib/sanitize-html';
import { exportToCSV } from '../lib/utils';

import CustomDataTypes from './DataTypes';

const debug = debugLib('models:Transaction');

/*
 * Transaction model
 * - this indicates that money was moved in the system
 */
export default (Sequelize, DataTypes) => {
  const { models } = Sequelize;

  const Transaction = Sequelize.define(
    'Transaction',
    {
      type: DataTypes.STRING, // DEBIT or CREDIT

      uuid: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        unique: true,
      },

      description: DataTypes.STRING,
      amount: DataTypes.INTEGER,

      currency: CustomDataTypes(DataTypes).currency,

      CreatedByUserId: {
        type: DataTypes.INTEGER,
        references: {
          model: 'Users',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        allowNull: false,
      },

      // Source of the money for a DEBIT
      // Recipient of the money for a CREDIT
      FromCollectiveId: {
        type: DataTypes.INTEGER,
        references: {
          model: 'Collectives',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        allowNull: true, // when a host adds funds, we need to create a transaction to add money to the system (to the host collective)
      },

      CollectiveId: {
        type: DataTypes.INTEGER,
        references: {
          model: 'Collectives',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        allowNull: false,
      },

      // Keeps a reference to the host because this is where the bank account is
      // Note that the host can also change over time (that's why just keeping CollectiveId is not enough)
      HostCollectiveId: {
        type: DataTypes.INTEGER,
        references: {
          model: 'Collectives',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        allowNull: true, // the opposite transaction that records the CREDIT to the User that submitted an expense doesn't have a HostCollectiveId, see https://github.com/opencollective/opencollective/issues/1154
      },

      UsingVirtualCardFromCollectiveId: {
        type: DataTypes.INTEGER,
        references: { model: 'Collectives', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        allowNull: true,
        description: 'References the collective that created the virtual card used for this order',
      },

      OrderId: {
        type: DataTypes.INTEGER,
        references: {
          model: 'Orders',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        allowNull: true,
      },

      // Refactor: an Expense should be an Order
      ExpenseId: {
        type: DataTypes.INTEGER,
        references: {
          model: 'Expenses',
          key: 'id',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        allowNull: true,
      },

      // stores the currency that the transaction happened in (currency of the host)
      hostCurrency: {
        type: DataTypes.STRING,
        set(val) {
          if (val && val.toUpperCase) {
            this.setDataValue('hostCurrency', val.toUpperCase());
          }
        },
      },

      // stores the foreign exchange rate at the time of transaction between donation currency and transaction currency
      // amountInCollectiveCurrency * hostCurrencyFxRate = amountInHostCurrency
      // Expense amount * hostCurrencyFxRate = amountInHostCurrency
      hostCurrencyFxRate: DataTypes.FLOAT,

      // amount in currency of the host
      amountInHostCurrency: DataTypes.INTEGER,
      platformFeeInHostCurrency: DataTypes.INTEGER,
      hostFeeInHostCurrency: DataTypes.INTEGER,
      paymentProcessorFeeInHostCurrency: DataTypes.INTEGER,
      taxAmount: { type: DataTypes.INTEGER },
      netAmountInCollectiveCurrency: DataTypes.INTEGER, // stores the net amount received by the collective (after fees) or removed from the collective (including fees)

      data: DataTypes.JSONB,

      // Note: Not a foreign key, should have been lower case t, 'transactionGroup`
      TransactionGroup: {
        type: DataTypes.UUID,
      },

      RefundTransactionId: {
        type: DataTypes.INTEGER,
        references: { model: 'Transactions', key: 'id' },
      },

      createdAt: {
        type: DataTypes.DATE,
        defaultValue: Sequelize.NOW,
      },

      deletedAt: {
        type: DataTypes.DATE,
      },
    },
    {
      paranoid: true,

      getterMethods: {
        netAmountInHostCurrency() {
          return (
            this.amountInHostCurrency +
            this.paymentProcessorFeeInHostCurrency +
            this.platformFeeInHostCurrency +
            this.hostFeeInHostCurrency
          );
        },

        amountSentToHostInHostCurrency() {
          return this.amountInHostCurrency + this.paymentProcessorFeeInHostCurrency + this.platformFeeInHostCurrency;
        },

        // Info.
        info() {
          return {
            id: this.id,
            uuid: this.uuid,
            type: this.type,
            description: this.description,
            amount: this.amount,
            currency: this.currency,
            createdAt: this.createdAt,
            CreatedByUserId: this.CreatedByUserId,
            FromCollectiveId: this.FromCollectiveId,
            CollectiveId: this.CollectiveId,
            UsingVirtualCardFromCollectiveId: this.UsingVirtualCardFromCollectiveId,
            platformFee: this.platformFee,
            platformFeeInHostCurrency: this.platformFeeInHostCurrency,
            hostFee: this.hostFee,
            hostFeeInHostCurrency: this.hostFeeInHostCurrency,
            paymentProcessorFeeInHostCurrency: this.paymentProcessorFeeInHostCurrency,
            amountInHostCurrency: this.amountInHostCurrency,
            netAmountInCollectiveCurrency: this.netAmountInCollectiveCurrency,
            netAmountInHostCurrency: this.netAmountInHostCurrency,
            amountSentToHostInHostCurrency: this.amountSentToHostInHostCurrency,
            hostCurrency: this.hostCurrency,
            ExpenseId: this.ExpenseId,
          };
        },
      },

      hooks: {
        afterCreate: transaction => {
          Transaction.createActivity(transaction);
          // intentionally returns null, needs to be async (https://github.com/petkaantonov/bluebird/blob/master/docs/docs/warning-explanations.md#warning-a-promise-was-created-in-a-handler-but-was-not-returned-from-it)
          return null;
        },
      },
    },
  );

  /**
   * Instance Methods
   */
  Transaction.prototype.getUser = function () {
    return models.User.findByPk(this.CreatedByUserId);
  };

  Transaction.prototype.getVirtualCardEmitterCollective = function () {
    if (this.UsingVirtualCardFromCollectiveId) {
      return models.Collective.findByPk(this.UsingVirtualCardFromCollectiveId);
    }
  };

  Transaction.prototype.getHostCollective = async function () {
    let HostCollectiveId = this.HostCollectiveId;
    // if the transaction is from the perspective of the fromCollective
    if (!HostCollectiveId) {
      const fromCollective = await models.Collective.findByPk(this.FromCollectiveId);
      HostCollectiveId = await fromCollective.getHostCollectiveId();
    }
    return models.Collective.findByPk(HostCollectiveId);
  };

  Transaction.prototype.getSource = function () {
    if (this.OrderId) {
      return this.getOrder({ paranoid: false });
    }
    if (this.ExpenseId) {
      return this.getExpense({ paranoid: false });
    }
  };

  /**
   * Returns the transaction payment method provider collective ID, which is
   * either the virtual card provider if using a virtual card or
   * `CollectiveId` otherwise.
   */
  Transaction.prototype.paymentMethodProviderCollectiveId = function () {
    if (this.UsingVirtualCardFromCollectiveId) {
      return this.UsingVirtualCardFromCollectiveId;
    }
    return this.type === 'DEBIT' ? this.CollectiveId : this.FromCollectiveId;
  };

  Transaction.prototype.getDetailsForUser = function (user) {
    const sourceCollective = this.paymentMethodProviderCollectiveId();
    return user.populateRoles().then(() => {
      if (
        user.isAdmin(this.CollectiveId) ||
        user.isAdmin(this.FromCollectiveId) ||
        user.isAdmin(sourceCollective) ||
        user.isRoot()
      ) {
        return this.uuid;
      } else {
        return null;
      }
    });
  };

  Transaction.prototype.getRefundTransaction = function () {
    if (!this.RefundTransactionId) {
      return null;
    }
    return Transaction.findByPk(this.RefundTransactionId);
  };

  /**
   * Class Methods
   */
  Transaction.createMany = (transactions, defaultValues) => {
    return Promise.map(transactions, transaction => {
      for (const attr in defaultValues) {
        transaction[attr] = defaultValues[attr];
      }
      return Transaction.create(transaction);
    }).catch(console.error);
  };

  Transaction.createManyDoubleEntry = (transactions, defaultValues) => {
    return Promise.map(transactions, transaction => {
      for (const attr in defaultValues) {
        transaction[attr] = defaultValues[attr];
      }
      return Transaction.createDoubleEntry(transaction);
    }).catch(console.error);
  };

  Transaction.exportCSV = (transactions, collectivesById) => {
    const getColumnName = attr => {
      if (attr === 'CollectiveId') {
        return 'collective';
      }
      if (attr === 'Expense.privateMessage') {
        return 'private note';
      } else {
        return attr;
      }
    };

    const processValue = (attr, value) => {
      if (attr === 'CollectiveId') {
        return get(collectivesById[value], 'slug');
      } else if (attr === 'createdAt') {
        return moment(value).format('YYYY-MM-DD');
      } else if (attr === 'Expense.privateMessage') {
        return value && stripHTML(value);
      } else if (
        [
          'amount',
          'netAmountInCollectiveCurrency',
          'paymentProcessorFeeInHostCurrency',
          'hostFeeInHostCurrency',
          'platformFeeInHostCurrency',
          'netAmountInHostCurrency',
        ].indexOf(attr) !== -1
      ) {
        return value / 100; // converts cents
      }
      return value;
    };

    const attributes = [
      'id',
      'createdAt',
      'type',
      'CollectiveId',
      'amount',
      'currency',
      'description',
      'netAmountInCollectiveCurrency',
      'hostCurrency',
      'hostCurrencyFxRate',
      'paymentProcessorFeeInHostCurrency',
      'hostFeeInHostCurrency',
      'platformFeeInHostCurrency',
      'netAmountInHostCurrency',
      'Expense.privateMessage',
    ];

    // We only add tax amount for european hosts
    if (transactions[0].hostCurrency === 'EUR') {
      attributes.splice(5, 0, 'taxAmount');
    }

    return exportToCSV(transactions, attributes, getColumnName, processValue);
  };

  /**
   * Create the opposite transaction from the perspective of the FromCollective
   * There is no fees
   * @POST Two transactions are created. Returns the initial transaction FromCollectiveId -> CollectiveId
   *
   * Examples (simplified with rounded numbers):
   * - Expense1 from User1 paid by Collective1
   *   - amount: $10
   *   - PayPal Fees: $1
   *   - Host Fees: $0
   *   - Platform Fees: $0
   *   => DEBIT: Collective: C1, FromCollective: U1
   *      amount: -$10, netAmountInCollectiveCurrency: -$11, paymentProcessorFeeInHostCurrency: -$1, platformFeeInHostCurrency: 0, hostFeeInHostCurrency: 0
   *   => CREDIT: Collective: U1, FromCollective: C1
   *      amount: $11, netAmountInCollectiveCurrency: $10, paymentProcessorFeeInHostCurrency: -$1, platformFeeInHostCurrency: 0, hostFeeInHostCurrency: 0
   *
   * - Donation1 from User1 to Collective1
   *   - amount: $10
   *   - Stripe Fees: $1
   *   - Host Fees: $1
   *   - Platform Fees: $1
   *   => DEBIT: Collective: U1, FromCollective: C1
   *      amount: -$7, netAmountInCollectiveCurrency: -$10, paymentProcessorFeeInHostCurrency: -$1, platformFeeInHostCurrency: -$1, hostFeeInHostCurrency: -$1
   *   => CREDIT: Collective: C1, FromCollective: U1
   *      amount: $10, netAmountInCollectiveCurrency: $7, paymentProcessorFeeInHostCurrency: -$1, platformFeeInHostCurrency: -$1, hostFeeInHostCurrency: -$1
   *
   * Note:
   * We should simplify a Transaction to:
   * CollectiveId, DEBIT/CREDIT, amount, currency, OrderId where amount is always the net amount in the currency of CollectiveId
   * and we should move paymentProcessorFee, platformFee, hostFee to the Order model
   *
   */

  Transaction.createDoubleEntry = async transaction => {
    transaction.type = transaction.amount > 0 ? TransactionTypes.CREDIT : TransactionTypes.DEBIT;
    transaction.netAmountInCollectiveCurrency = transaction.netAmountInCollectiveCurrency || transaction.amount;
    transaction.TransactionGroup = uuid();
    transaction.hostCurrencyFxRate = transaction.hostCurrencyFxRate || 1;

    if (!isUndefined(transaction.amountInHostCurrency)) {
      // ensure this is always INT
      transaction.amountInHostCurrency = Math.round(transaction.amountInHostCurrency);
    }

    // Is the target "collective" (account) "Active" (has an host, manage its own budget)
    const fromCollective = await models.Collective.findByPk(transaction.FromCollectiveId);

    let oppositeTransaction = {
      ...transaction,
      type: -transaction.amount > 0 ? TransactionTypes.CREDIT : TransactionTypes.DEBIT,
      FromCollectiveId: transaction.CollectiveId,
      CollectiveId: transaction.FromCollectiveId,
      amountInHostCurrency: Math.round(-transaction.netAmountInCollectiveCurrency * transaction.hostCurrencyFxRate),
      hostFeeInHostCurrency: transaction.hostFeeInHostCurrency,
      platformFeeInHostCurrency: transaction.platformFeeInHostCurrency,
      paymentProcessorFeeInHostCurrency: transaction.paymentProcessorFeeInHostCurrency,
    };
    if (!fromCollective.isActive) {
      oppositeTransaction = {
        ...oppositeTransaction,
        HostCollectiveId: null,
        amount: -transaction.netAmountInCollectiveCurrency,
        netAmountInCollectiveCurrency: -transaction.amount,
      };
    } else {
      const oppositeTransactionCurrencyFxRate = await getFxRate(
        transaction.currency,
        fromCollective.currency,
        transaction.createdAt,
      );
      oppositeTransaction = {
        ...oppositeTransaction,
        HostCollectiveId: fromCollective.HostCollectiveId,
        currency: fromCollective.currency,
        amount: -Math.round(transaction.netAmountInCollectiveCurrency * oppositeTransactionCurrencyFxRate),
        netAmountInCollectiveCurrency: -Math.round(transaction.amount * oppositeTransactionCurrencyFxRate),
        data: { ...transaction.data, oppositeTransactionCurrencyFxRate },
      };
    }

    debug('createDoubleEntry', transaction, 'opposite', oppositeTransaction);

    // We first record the negative transaction
    // and only then we can create the transaction to add money somewhere else
    const transactions = [];
    let index = 0;
    if (transaction.amount < 0) {
      index = 0;
      transactions.push(transaction);
      transactions.push(oppositeTransaction);
    } else {
      index = 1;
      transactions.push(oppositeTransaction);
      transactions.push(transaction);
    }
    return Promise.mapSeries(transactions, t => Transaction.create(t)).then(results => results[index]);
  };

  Transaction.createFeesOnTopTransaction = async ({ transaction }) => {
    if (!transaction.data?.isFeesOnTop) {
      throw new Error('This transaction does not have fees on top');
    } else if (!transaction.platformFeeInHostCurrency) {
      return;
    }

    const platformFeeToDonationRate = Math.abs(
      transaction.platformFeeInHostCurrency / transaction.amountInHostCurrency,
    );
    const paymentProcessorFeeInHostCurrency = toNegative(
      Math.round(transaction.paymentProcessorFeeInHostCurrency * platformFeeToDonationRate),
    );
    const platformCurrencyFxRate = await getFxRate(transaction.currency, FEES_ON_TOP_TRANSACTION_PROPERTIES.currency);
    const donationTransaction = defaultsDeep(
      {},
      FEES_ON_TOP_TRANSACTION_PROPERTIES,
      {
        description: 'Financial contribution to Open Collective',
        amount: Math.round(Math.abs(transaction.platformFeeInHostCurrency) * platformCurrencyFxRate),
        amountInHostCurrency: Math.round(Math.abs(transaction.platformFeeInHostCurrency) * platformCurrencyFxRate),
        platformFeeInHostCurrency: 0,
        hostFeeInHostCurrency: 0,
        paymentProcessorFeeInHostCurrency: Math.round(paymentProcessorFeeInHostCurrency * platformCurrencyFxRate),
        netAmountInCollectiveCurrency: Math.round(
          (Math.abs(transaction.platformFeeInHostCurrency) + paymentProcessorFeeInHostCurrency) *
            platformCurrencyFxRate,
        ),
        // This is always 1 because OpenCollective and OpenCollective Inc (Host) are in USD.
        hostCurrencyFxRate: 1,
        data: {
          hostToPlatformFxRate: await getFxRate(transaction.hostCurrency, FEES_ON_TOP_TRANSACTION_PROPERTIES.currency),
        },
      },
      transaction,
    );

    await Transaction.createDoubleEntry(donationTransaction);

    // Remove fees from main transaction
    transaction.paymentProcessorFeeInHostCurrency =
      transaction.paymentProcessorFeeInHostCurrency - paymentProcessorFeeInHostCurrency;
    transaction.amountInHostCurrency = transaction.amountInHostCurrency + transaction.platformFeeInHostCurrency;
    transaction.amount =
      transaction.amount + transaction.platformFeeInHostCurrency / (transaction.hostCurrencyFxRate || 1);
    transaction.platformFeeInHostCurrency = 0;

    return transaction;
  };

  Transaction.createFromPayload = async ({
    CreatedByUserId,
    FromCollectiveId,
    CollectiveId,
    transaction,
    PaymentMethodId,
  }) => {
    if (!transaction.amount) {
      throw new Error('transaction.amount cannot be null or zero');
    }

    const collective = await models.Collective.findByPk(CollectiveId);
    const HostCollectiveId = collective.isHostAccount ? collective.id : await collective.getHostCollectiveId();
    if (!HostCollectiveId && !transaction.HostCollectiveId) {
      throw new Error(`Cannot create a transaction: collective id ${CollectiveId} doesn't have a host`);
    }
    transaction.HostCollectiveId = HostCollectiveId || transaction.HostCollectiveId;
    // attach other objects manually. Needed for afterCreate hook to work properly
    transaction.CreatedByUserId = CreatedByUserId;
    transaction.FromCollectiveId = FromCollectiveId;
    transaction.CollectiveId = CollectiveId;
    transaction.PaymentMethodId = transaction.PaymentMethodId || PaymentMethodId;
    transaction.type = transaction.amount > 0 ? TransactionTypes.CREDIT : TransactionTypes.DEBIT;
    transaction.hostFeeInHostCurrency = toNegative(transaction.hostFeeInHostCurrency);
    transaction.platformFeeInHostCurrency = toNegative(transaction.platformFeeInHostCurrency);
    transaction.taxAmount = toNegative(transaction.taxAmount);
    transaction.paymentProcessorFeeInHostCurrency = toNegative(transaction.paymentProcessorFeeInHostCurrency);

    // Separate donation transaction and remove platformFee from the main transaction
    if (transaction.data?.isFeesOnTop && transaction.platformFeeInHostCurrency) {
      transaction = await Transaction.createFeesOnTopTransaction({ transaction });
    }

    if (transaction.amount > 0) {
      // populate netAmountInCollectiveCurrency for donations
      const fees =
        (transaction.taxAmount || 0) +
        transaction.platformFeeInHostCurrency +
        transaction.hostFeeInHostCurrency +
        transaction.paymentProcessorFeeInHostCurrency;
      transaction.netAmountInCollectiveCurrency = transaction.amountInHostCurrency + fees; // `fees` is a negative number
      if (transaction.hostCurrencyFxRate) {
        transaction.netAmountInCollectiveCurrency = Math.round(
          transaction.netAmountInCollectiveCurrency / transaction.hostCurrencyFxRate,
        );
      }
    }

    return Transaction.createDoubleEntry(transaction);
  };

  Transaction.createActivity = transaction => {
    if (transaction.deletedAt) {
      return Promise.resolve();
    }
    return (
      Transaction.findByPk(transaction.id, {
        include: [
          { model: models.Collective, as: 'fromCollective' },
          { model: models.Collective, as: 'collective' },
          { model: models.User, as: 'createdByUser' },
          { model: models.PaymentMethod },
        ],
      })
        // Create activity.
        .then(transaction => {
          const activityPayload = {
            type: activities.COLLECTIVE_TRANSACTION_CREATED,
            TransactionId: transaction.id,
            CollectiveId: transaction.CollectiveId,
            CreatedByUserId: transaction.CreatedByUserId,
            data: {
              transaction: transaction.info,
              user: transaction.User && transaction.User.minimal,
              fromCollective: transaction.fromCollective && transaction.fromCollective.minimal,
              collective: transaction.collective && transaction.collective.minimal,
            },
          };
          if (transaction.createdByUser) {
            activityPayload.data.user = transaction.createdByUser.info;
          }
          if (transaction.PaymentMethod) {
            activityPayload.data.paymentMethod = transaction.PaymentMethod.info;
          }
          return models.Activity.create(activityPayload);
        })
        .catch(err =>
          console.error(
            `Error creating activity of type ${activities.COLLECTIVE_TRANSACTION_CREATED} for transaction ID ${transaction.id}`,
            err,
          ),
        )
    );
  };

  Transaction.creditHost = (order, collective) => {
    // Special Case, adding funds to itself
    const amount = order.totalAmount;
    const platformFeePercent = get(order, 'data.platformFeePercent', 0);
    const platformFee = calcFee(order.totalAmount, platformFeePercent);
    const payload = {
      type: 'CREDIT',
      amount,
      description: order.description,
      currency: order.currency,
      CollectiveId: order.CollectiveId,
      FromCollectiveId: order.CollectiveId,
      CreatedByUserId: order.CreatedByUserId,
      PaymentMethodId: order.PaymentMethodId,
      OrderId: order.id,
      platformFeeInHostCurrency: -platformFee,
      hostFeeInHostCurrency: 0,
      paymentProcessorFeeInHostCurrency: 0,
      HostCollectiveId: collective.id,
      hostCurrency: collective.currency,
      hostCurrencyFxRate: 1,
      amountInHostCurrency: amount,
      netAmountInCollectiveCurrency: amount - platformFee,
      TransactionGroup: uuid(),
    };

    return models.Transaction.create(payload);
  };

  return Transaction;
};
