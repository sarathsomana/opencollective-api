import { GraphQLInputFieldConfigMap, GraphQLInputObjectType, GraphQLString } from 'graphql';

export const PaymentMethodInput = new GraphQLInputObjectType({
  name: 'PaymentMethodInput',
  description: 'An input to use for creating or retrieving payment methods',
  fields: (): GraphQLInputFieldConfigMap => ({
    id: {
      type: GraphQLString,
      description: 'The id assigned to the payment method',
    },
  }),
});
