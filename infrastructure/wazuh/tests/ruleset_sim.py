"""Minimal simulator for the subset of Wazuh decoder/rule syntax used in this repo.

Supported: decoders with <parent>, <prematch type="pcre2">, <regex type="pcre2">
with <order>, sibling decoders sharing a name, and the built-in JSON decoder;
rules with <decoded_as>, <if_sid>, <field type="pcre2" [negate="yes"]>,
<match type="pcre2">, <group>, <description>. Anything else raises, so the
simulator never silently ignores syntax it does not understand.

Unlike Wazuh, which takes the first matching child rule, the simulator raises
when two sibling rules match the same event, keeping the rules mutually
exclusive so each event alerts exactly once.
"""
import dataclasses
import json
import re
import xml.etree.ElementTree as ET

DECODER_TAGS = {"parent", "prematch", "regex", "order"}
RULE_TAGS = {"decoded_as", "if_sid", "field", "match", "group", "description", "mitre"}


class UnsupportedSyntax(Exception):
    pass


def _parse_fragment(path):
    return ET.fromstring(f"<root>{path.read_text()}</root>")


def _pcre2(element):
    if element.get("type") != "pcre2":
        raise UnsupportedSyntax(f"<{element.tag}> must use type=\"pcre2\": {element.text}")
    return re.compile(element.text or "")


@dataclasses.dataclass
class Decoder:
    name: str
    parent: str | None = None
    prematch: re.Pattern | None = None
    regex: re.Pattern | None = None
    order: list = dataclasses.field(default_factory=list)


@dataclasses.dataclass
class Rule:
    id: int
    level: int
    groups: list
    decoded_as: str | None = None
    if_sid: list = dataclasses.field(default_factory=list)
    fields: list = dataclasses.field(default_factory=list)  # (name, pattern, negate)
    match: re.Pattern | None = None
    description: str = ""

    def matches(self, decoder, fields, log):
        if self.decoded_as and self.decoded_as != decoder:
            return False
        if self.match and not self.match.search(log):
            return False
        for name, pattern, negate in self.fields:
            value = fields.get(name)
            found = value is not None and pattern.search(str(value)) is not None
            if found == negate:
                return False
        return True


@dataclasses.dataclass
class Result:
    decoder: str | None
    fields: dict
    rule: Rule | None

    def category(self, categories):
        if self.rule is None or self.rule.level < 3:
            return None
        matched = [g for g in self.rule.groups if g in categories]
        if len(matched) > 1:
            raise AssertionError(f"rule {self.rule.id} must carry at most one category, has {matched}")
        return matched[0] if matched else None


class Ruleset:
    def __init__(self, decoders, rules):
        self.decoders = decoders
        self.rules = rules

    @classmethod
    def load(cls, decoder_paths, rule_paths):
        decoders = []
        for path in decoder_paths:
            for el in _parse_fragment(path):
                if el.tag != "decoder":
                    raise UnsupportedSyntax(f"unexpected <{el.tag}> in {path.name}")
                decoders.append(cls._decoder(el))
        rules = []
        for path in rule_paths:
            for group in _parse_fragment(path):
                if group.tag != "group":
                    raise UnsupportedSyntax(f"rules must be inside <group> in {path.name}")
                base_groups = [g for g in group.get("name", "").split(",") if g]
                for el in group:
                    rules.append(cls._rule(el, base_groups))
        return cls(decoders, rules)

    @staticmethod
    def _decoder(el):
        decoder = Decoder(name=el.get("name"))
        for child in el:
            if child.tag not in DECODER_TAGS:
                raise UnsupportedSyntax(f"decoder {decoder.name}: <{child.tag}>")
            if child.tag == "parent":
                decoder.parent = child.text
            elif child.tag == "prematch":
                decoder.prematch = _pcre2(child)
            elif child.tag == "regex":
                decoder.regex = _pcre2(child)
            elif child.tag == "order":
                decoder.order = [o.strip() for o in child.text.split(",")]
        if decoder.regex and decoder.regex.groups != len(decoder.order):
            raise UnsupportedSyntax(f"decoder {decoder.name}: capture groups do not match <order>")
        return decoder

    @staticmethod
    def _rule(el, base_groups):
        if el.tag != "rule":
            raise UnsupportedSyntax(f"unexpected <{el.tag}> in rule group")
        rule = Rule(id=int(el.get("id")), level=int(el.get("level")), groups=list(base_groups))
        for child in el:
            if child.tag not in RULE_TAGS:
                raise UnsupportedSyntax(f"rule {rule.id}: <{child.tag}>")
            if child.tag == "decoded_as":
                rule.decoded_as = child.text
            elif child.tag == "if_sid":
                rule.if_sid = [int(s) for s in re.split(r"[,\s]+", child.text.strip())]
            elif child.tag == "field":
                rule.fields.append((child.get("name"), _pcre2(child), child.get("negate") == "yes"))
            elif child.tag == "match":
                rule.match = _pcre2(child)
            elif child.tag == "group":
                rule.groups += [g for g in child.text.split(",") if g]
            elif child.tag == "description":
                rule.description = child.text
        return rule

    def decode(self, log):
        stripped = log.strip()
        if stripped.startswith("{"):
            try:
                return "json", _flatten(json.loads(stripped))
            except json.JSONDecodeError:
                pass
        for parent in (d for d in self.decoders if d.parent is None):
            if parent.prematch and not parent.prematch.search(log):
                continue
            fields = {}
            for child in (d for d in self.decoders if d.parent == parent.name):
                if child.prematch and not child.prematch.search(log):
                    continue
                if child.regex:
                    m = child.regex.search(log)
                    if m:
                        fields.update({k: v for k, v in zip(child.order, m.groups()) if v is not None})
            return parent.name, fields
        return None, {}

    def process(self, log):
        decoder, fields = self.decode(log)
        matched = None
        candidates = [r for r in self.rules if not r.if_sid]
        while True:
            hits = [r for r in candidates if r.matches(decoder, fields, log)]
            if not hits:
                break
            if len(hits) > 1:
                raise AssertionError(f"ambiguous rules {[r.id for r in hits]} for: {log}")
            matched = hits[0]
            candidates = [r for r in self.rules if matched.id in r.if_sid]
        return Result(decoder, fields, matched)


def _flatten(data, prefix=""):
    out = {}
    for key, value in data.items():
        name = f"{prefix}{key}"
        if isinstance(value, dict):
            out.update(_flatten(value, f"{name}."))
        else:
            out[name] = value
    return out
