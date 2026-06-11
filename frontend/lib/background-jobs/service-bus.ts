import { createHmac, randomUUID } from 'node:crypto';

export class BackgroundJobQueueConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackgroundJobQueueConfigurationError';
  }
}

export class BackgroundJobQueueSendError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BackgroundJobQueueSendError';
    this.status = status;
  }
}

interface ServiceBusConnectionParts {
  endpoint: string;
  sharedAccessKeyName: string;
  sharedAccessKey: string;
}

export interface UploadJobQueueMessage {
  jobID: number;
  kind: 'upload_validation';
}

export interface QueueSendResult {
  messageID: string;
  queueName: string;
}

function parseConnectionString(connectionString: string): ServiceBusConnectionParts {
  const parts = new Map<string, string>();
  for (const segment of connectionString.split(';')) {
    const [key, ...valueParts] = segment.split('=');
    if (!key || valueParts.length === 0) continue;
    parts.set(key, valueParts.join('='));
  }

  const endpoint = parts.get('Endpoint');
  const sharedAccessKeyName = parts.get('SharedAccessKeyName');
  const sharedAccessKey = parts.get('SharedAccessKey');

  if (!endpoint || !sharedAccessKeyName || !sharedAccessKey) {
    throw new BackgroundJobQueueConfigurationError('AZURE_SERVICE_BUS_CONNECTION_STRING must include Endpoint, SharedAccessKeyName, and SharedAccessKey');
  }

  return { endpoint, sharedAccessKeyName, sharedAccessKey };
}

function createSasToken(resourceUri: string, keyName: string, key: string): string {
  const expires = Math.floor(Date.now() / 1000) + 5 * 60;
  const encodedResourceUri = encodeURIComponent(resourceUri);
  const signature = createHmac('sha256', key).update(`${encodedResourceUri}\n${expires}`).digest('base64');

  return `SharedAccessSignature sr=${encodedResourceUri}&sig=${encodeURIComponent(signature)}&se=${expires}&skn=${encodeURIComponent(keyName)}`;
}

function getQueueConfig() {
  const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  const queueName = process.env.AZURE_SERVICE_BUS_UPLOAD_QUEUE_NAME || process.env.AZURE_SERVICE_BUS_QUEUE_NAME;

  if (!connectionString) {
    throw new BackgroundJobQueueConfigurationError('AZURE_SERVICE_BUS_CONNECTION_STRING is not configured');
  }
  if (!queueName) {
    throw new BackgroundJobQueueConfigurationError('AZURE_SERVICE_BUS_UPLOAD_QUEUE_NAME is not configured');
  }

  return {
    connection: parseConnectionString(connectionString),
    queueName
  };
}

export function isBackgroundJobQueueConfigured(): boolean {
  return Boolean(
    process.env.AZURE_SERVICE_BUS_CONNECTION_STRING && (process.env.AZURE_SERVICE_BUS_UPLOAD_QUEUE_NAME || process.env.AZURE_SERVICE_BUS_QUEUE_NAME)
  );
}

export async function enqueueUploadBackgroundJob(message: UploadJobQueueMessage): Promise<QueueSendResult> {
  const { connection, queueName } = getQueueConfig();
  const endpoint = connection.endpoint.replace(/^sb:\/\//, 'https://').replace(/\/+$/, '');
  const resourceUri = `${endpoint}/${encodeURIComponent(queueName)}`;
  const sendUrl = `${resourceUri}/messages`;
  const messageID = `upload-job-${message.jobID}-${randomUUID()}`;
  const authorization = createSasToken(resourceUri, connection.sharedAccessKeyName, connection.sharedAccessKey);

  const response = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      BrokerProperties: JSON.stringify({
        MessageId: messageID,
        Label: 'upload_validation'
      })
    },
    body: JSON.stringify(message)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new BackgroundJobQueueSendError(`Failed to enqueue upload job ${message.jobID}: HTTP ${response.status}${text ? ` ${text}` : ''}`, response.status);
  }

  return { messageID, queueName };
}
