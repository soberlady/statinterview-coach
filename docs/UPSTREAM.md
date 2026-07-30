# Upstream boundary

## References

- LiveKit Meet: Apache-2.0
  <https://github.com/livekit-examples/meet>
- LiveKit Agents Python starter: MIT
  <https://github.com/livekit-examples/agent-starter-python>
- LiveKit Agents framework
  <https://github.com/livekit/agents>

## What is reused

- LiveKit's room/participant model for realtime transport;
- the current `AgentServer` and `AgentSession` worker lifecycle;
- final-transcript events as the voice evidence boundary;
- the design assumption that web, mobile and telephony clients can share one
  agent backend.

## What is original here

- the interview state machine and recovery contract;
- the four-dimensional ability model;
- question bank and anchor design;
- information-value selection constraints;
- reliability, verification and abstention policy;
- evidence-linked report and D1 audit schema;
- Chinese data-analysis internship product surface.

## Resume wording rule

The browser room and token endpoint are now implemented, but this remains an
original integration rather than a LiveKit Meet fork. Describe it as
“integrated LiveKit browser audio and an Agents worker with explicit dispatch.”
Do not say “production voice system” until a real cloud project has been run
and latency, transcript quality and reconnection results are published.
