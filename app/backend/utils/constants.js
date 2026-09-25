'use strict'

const FIXED_EXPENSE_TYPES = [
  'bank',
  'shopee_paylater',
  'tiktok_paylater',
  'credit_card',
  'bill',
  'property',
  'vehicle',
  'hutang_orang',
  'others',
]

const VARIABLE_EXPENSE_TYPES = [
  'food',
  'groceries',
  'parent',
  'toll',
  'fuel',
  'others',
]

const MONTH_STATUSES = ['OPEN', 'CLOSED']

module.exports = { FIXED_EXPENSE_TYPES, VARIABLE_EXPENSE_TYPES, MONTH_STATUSES }