# Generated from pagelove/system/authz.html. Anonymous only: safe to run any time.
Feature: Access rules on the live host
  The host denies unmatched GETs, so only the paths authz.html opens are public.

  Scenario Outline: the public app shell is reachable
    Given I am anonymous
    When I GET "<path>"
    Then the status is 200
    Examples:
      | path         |
      | /            |
      | /index.html  |
      | /favicon.svg |

  Scenario: the session probe says signed out
    Given I am anonymous
    When I GET "/api/me"
    Then the status is 200
    And the JSON "signedIn" is "false"
    And the header "Cache-Control" contains "no-store"

  Scenario Outline: internal documents stay private
    Given I am anonymous
    When I GET "<path>"
    Then the status is 401
    Examples:
      | path                  |
      | /data/links.html      |
      | /system/authz.html    |
      | /system/schema.html   |
      | /system/triggers.html |
      | /anything-else.html   |

  Scenario Outline: the links API needs a session
    Given I am anonymous
    When I <method> "/api/links"
    Then the status is 401
    Examples:
      | method |
      | GET    |
      | DELETE |

  Scenario: anonymous create is refused
    Given I am anonymous
    When I POST to "/api/links" with JSON:
      """
      {"url": "https://example.com/{{run}}"}
      """
    Then the status is 401

  Scenario: anonymous visitors can't write data documents directly
    Given I am anonymous
    When I POST to "/data/links.html" with JSON:
      """
      {}
      """
    Then the status is one of "401, 403, 405"

  Scenario: unknown short links get the friendly 404
    Given I am anonymous
    When I GET "/s/{{run}}"
    Then the status is 404
    And the body contains "Link not found"
