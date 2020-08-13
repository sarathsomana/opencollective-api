import { GraphQLFloat, GraphQLInputObjectType, GraphQLInt } from 'graphql';
import { isNil } from 'lodash';

import { floatAmountToCents } from '../../../../server/lib/math';
import { Currency } from '../enum/Currency';

export const AmountInput = new GraphQLInputObjectType({
  name: 'AmountInput',
  description: 'Input type for an amount with the value and currency',
  fields: () => ({
    value: {
      type: GraphQLFloat,
      description: 'The value in plain',
    },
    currency: {
      type: Currency,
      description: 'The currency string',
    },
    valueInCents: {
      type: GraphQLInt,
      description: 'The value in cents',
    },
  }),
});

export const getValueInCentsFromAmountInput = input => {
  if (!isNil(input.valueInCents)) {
    return input.valueInCents;
  } else if (!isNil(input.value)) {
    return floatAmountToCents(input.value);
  } else {
    throw new Error('You must either set a `value` or a `valueInCents` when submitting an AmountInput');
  }
};
