import React, { useState } from 'react';
import { ApiClient } from 'adminjs';
import type { ActionProps } from 'adminjs';
import { Box, Button, FormGroup, Label, Input, MessageBox, Text } from '@adminjs/design-system';

const api = new ApiClient();

const AdjustWallet: React.FC<ActionProps> = (props) => {
  const { record, resource } = props;
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);

    if (!amount || Number(amount) <= 0) {
      setError('Enter an amount greater than zero');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Reason must be at least 5 characters — this goes into the audit log');
      return;
    }

    setLoading(true);
    try {
      const response = await api.recordAction({
        resourceId: resource.id,
        recordId: record?.id ?? '',
        actionName: 'adjustWallet',
        data: { amount, direction, reason }
      });

      const notice = response.data?.notice as { message?: string; type?: string } | undefined;
      if (notice?.type === 'error') {
        setError(notice.message ?? 'Adjustment failed');
      } else {
        setDone(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <Box variant="grey" p="xl">
        <MessageBox message="Wallet adjusted. Reload the record to see the new balance." variant="success" />
      </Box>
    );
  }

  return (
    <Box variant="grey" p="xl">
      <Text mb="lg">
        Adjusting wallet for <strong>{String(record?.params?.fullName ?? '')}</strong> (
        {String(record?.params?.email ?? '')}). This is written to the audit log under your
        admin account.
      </Text>

      {error && <MessageBox message={error} variant="danger" mb="lg" />}

      <FormGroup>
        <Label>Direction</Label>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as 'credit' | 'debit')}
          style={{ width: '100%', padding: 8, fontSize: 14 }}
        >
          <option value="credit">Credit (add funds)</option>
          <option value="debit">Debit (remove funds)</option>
        </select>
      </FormGroup>

      <FormGroup>
        <Label>Amount (NGN)</Label>
        <Input
          value={amount}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
          type="number"
          min="0"
          step="0.01"
        />
      </FormGroup>

      <FormGroup>
        <Label>Reason (required, visible in the audit log)</Label>
        <Input value={reason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)} />
      </FormGroup>

      <Button onClick={submit} disabled={loading} variant="primary">
        {loading ? 'Submitting…' : 'Apply adjustment'}
      </Button>
    </Box>
  );
};

export default AdjustWallet;
