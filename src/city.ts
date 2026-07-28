import type { ClaimCity, FactoryCharter } from './types.js';

export function validateCity(
  city: ClaimCity,
  factories: FactoryCharter[]
): string[] {
  const reasons: string[] = [];
  const registered = new Set(city.factoryIds);
  const available = new Set(factories.map((factory) => factory.factoryId));

  for (const factoryId of registered) {
    if (!available.has(factoryId)) reasons.push(`factory_missing:${factoryId}`);
  }
  for (const factory of factories) {
    if (registered.has(factory.factoryId) && factory.cityId !== city.cityId) {
      reasons.push(`factory_city_mismatch:${factory.factoryId}`);
    }
    if (
      registered.has(factory.factoryId) &&
      factory.policyVersion !== city.policyVersion
    ) {
      reasons.push(`factory_policy_mismatch:${factory.factoryId}`);
    }
  }

  const registeredFactories = factories.filter((factory) =>
    registered.has(factory.factoryId)
  );
  if (!registeredFactories.some((factory) => factory.kind === 'producer')) {
    reasons.push('producer_factory_missing');
  }
  if (!registeredFactories.some((factory) => factory.kind === 'verifier')) {
    reasons.push('verifier_factory_missing');
  }

  return reasons;
}

export function selectVerificationFactories(
  city: ClaimCity,
  producer: FactoryCharter,
  factories: FactoryCharter[]
): FactoryCharter[] {
  if (producer.cityId !== city.cityId) {
    throw new Error('producer_outside_city');
  }

  return factories
    .filter(
      (factory) =>
        city.factoryIds.includes(factory.factoryId) &&
        factory.kind === 'verifier' &&
        factory.factoryId !== producer.factoryId &&
        factory.domain === producer.domain &&
        factory.policyVersion === city.policyVersion
    )
    .sort((left, right) => left.factoryId.localeCompare(right.factoryId));
}

