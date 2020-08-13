import { GraphQLInputObjectType, GraphQLInt, GraphQLList, GraphQLNonNull, GraphQLUnionType } from 'graphql';
import GraphQLJSON from 'graphql-type-json';

import { OrderFrequency } from '../enum/OrderFrequency';

import { AccountReferenceInput } from './AccountReferenceInput';
import { AmountInput } from './AmountInput';
import { OrderTaxInput } from './OrderTaxInput';
import { PaymentMethodInput } from './PaymentMethodInput';
import { TierReferenceInput } from './TierReferenceInput';

export const OrderCreateInput = new GraphQLInputObjectType({
  name: 'OrderCreateInput',
  description: 'Input to create a new order',
  fields: {
    quantity: {
      type: new GraphQLNonNull(GraphQLInt),
      defaultValue: 1,
    },
    amount: {
      type: new GraphQLNonNull(AmountInput),
      description: 'The contribution amount for 1 quantity, without platform contribution and taxes',
    },
    frequency: {
      type: new GraphQLNonNull(OrderFrequency),
    },
    fromAccount: {
      type: new GraphQLNonNull(AccountReferenceInput),
      description: 'The profile making the order',
    },
    account: {
      type: new GraphQLNonNull(AccountReferenceInput),
      description: 'The profile you want to contribute to',
    },
    paymentMethod: {
      description: 'The payment method used for this order',
      type: PaymentMethodInput,
    },
    platformContributionAmount: {
      type: AmountInput,
      description: 'Platform contribution attached to this order',
    },
    taxes: {
      type: new GraphQLList(OrderTaxInput),
      description: 'Use this field to set the taxes associated to this order',
    },
    tier: {
      type: TierReferenceInput,
      description: 'The tier you are contributing to',
    },
    customData: {
      type: GraphQLJSON,
      description: 'If the tier has some "customFields", use this field to set their values',
    },
  },
});
