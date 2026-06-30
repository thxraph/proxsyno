// Docker-in-guest shapes. Defined locally (lib/types.ts is owned elsewhere);
// these mirror services/dockerguest.ts on the backend.

export type Transport = 'pct' | 'agent';

export type ContainerState =
  | 'running'
  | 'exited'
  | 'created'
  | 'paused'
  | 'restarting'
  | 'dead';

export type ContainerAction = 'start' | 'stop' | 'restart' | 'remove';

export interface DockerStatus {
  dockerInstalled: boolean;
  dockerVersion?: string;
  reachable: boolean;
  transport: Transport;
  reason?: string;
}

export interface DockerPort {
  hostIp?: string;
  hostPort?: number;
  containerPort: number;
  proto: 'tcp' | 'udp';
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  status: string;
  ports: DockerPort[];
  createdSec: number;
}

export interface RunPortInput {
  hostPort: number;
  containerPort: number;
  proto: 'tcp' | 'udp';
}

export interface RunVolumeInput {
  hostPath: string;
  containerPath: string;
  readOnly?: boolean;
}

export interface RunEnvInput {
  key: string;
  value: string;
}

export interface RunContainerInput {
  image: string;
  name?: string;
  ports?: RunPortInput[];
  volumes?: RunVolumeInput[];
  env?: RunEnvInput[];
  restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
  network?: string;
  command?: string[];
}
